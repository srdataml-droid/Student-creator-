package org.worthkind.studentcreators;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.EditText;
import android.text.TextWatcher;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import java.util.Locale;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Native public catalog only. No native login, private media, purchase or enrollment. */
public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Future<?> pending;
    private int generation;
    private TextView heading, status;
    private Button retry, back, more;
    private Integer nextOffset;
    private EditText filter;
    private boolean resettingFilter;
    private final ArrayList<CatalogPreview.Row> visibleRows = new ArrayList<>();
    private int retryOffset;
    private boolean retryAppend;
    private final ArrayList<CatalogPreview.Row> displayed = new ArrayList<>();
    private ListView list;
    private String selectedCourse;
    private String selectedTitle;
    private CatalogTransport transport;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(16 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        layout.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(pad + insets.getSystemWindowInsetLeft(), pad + insets.getSystemWindowInsetTop(),
                pad + insets.getSystemWindowInsetRight(), pad + insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        heading = new TextView(this);
        heading.setId(R.id.catalog_heading);
        heading.setTextSize(24);
        if (Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        layout.addView(heading);
        status = new TextView(this);
        status.setId(R.id.catalog_status);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        layout.addView(status);
        retry = new Button(this);
        retry.setId(R.id.catalog_retry);
        retry.setText("Retry");
        retry.setOnClickListener(v -> loadPage(retryOffset, retryAppend));
        layout.addView(retry);
        back = new Button(this);
        back.setText("All courses");
        back.setOnClickListener(v -> returnToCourses());
        layout.addView(back);
        more = new Button(this);
        more.setId(R.id.catalog_more);
        more.setText("Load more previews");
        more.setVisibility(View.GONE);
        more.setOnClickListener(v -> { if (nextOffset != null) loadPage(nextOffset, true); });
        layout.addView(more);
        filter = new EditText(this);
        filter.setId(R.id.catalog_filter);
        filter.setSingleLine(true);
        filter.setInputType(InputType.TYPE_CLASS_TEXT);
        filter.setFilters(new InputFilter[]{new InputFilter.LengthFilter(80)});
        filter.setHint("Search loaded courses");
        filter.setContentDescription("Search loaded courses");
        filter.setVisibility(View.GONE);
        filter.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (!resettingFilter) renderRows();
            }
            @Override public void afterTextChanged(Editable s) {}
        });
        layout.addView(filter);
        list = new ListView(this);
        list.setId(R.id.catalog_list);
        layout.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        list.setOnItemClickListener((parent, view, position, id) -> {
            if (selectedCourse == null && position >= 0 && position < visibleRows.size()) {
                selectedCourse = visibleRows.get(position).id;
                selectedTitle = visibleRows.get(position).title;
                resetFilter(); load();
            }
        });
        setContentView(layout);
        if (state != null) {
            selectedCourse = state.getString("course");
            selectedTitle = state.getString("title");
        }
        try { transport = new CatalogTransport(BuildConfig.CATALOG_ORIGIN); }
        catch (IllegalArgumentException e) { transport = null; }
    }
    @Override protected void onStart() { super.onStart(); load(); }
    @Override protected void onStop() {
        generation++;
        if (pending != null) pending.cancel(true);
        super.onStop();
    }
    @Override protected void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("course", selectedCourse);
        out.putString("title", selectedTitle);
    }
    private void resetFilter() {
        resettingFilter = true;
        filter.setText("");
        resettingFilter = false;
    }
    private void returnToCourses() {
        selectedCourse = null; selectedTitle = null;
        resetFilter(); load();
    }
    @Override public void onBackPressed() {
        if (selectedCourse != null) returnToCourses(); else super.onBackPressed();
    }
    private void renderRows() {
        if (list == null) return;
        String query = filter.getText().toString().trim().toLowerCase(Locale.ROOT);
        visibleRows.clear();
        ArrayList<String> labels = new ArrayList<>();
        for (CatalogPreview.Row row : displayed) {
            if (query.isEmpty() || row.label().toLowerCase(Locale.ROOT).contains(query)) {
                visibleRows.add(row); labels.add(row.label());
            }
        }
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
        if (!query.isEmpty() && labels.isEmpty()) status.setText("No matching loaded results.");
        else if (displayed.isEmpty()) status.setText(nextOffset == null ? "No public previews available." : "No previews on this page. Load more to continue.");
        else status.setText(labels.size() + " " + (selectedCourse == null ? "courses shown" : "public previews shown") + (nextOffset == null ? "." : ". More available."));
    }
    private void load() { displayed.clear(); visibleRows.clear(); nextOffset = null; loadPage(0, false); }
    private void loadPage(int offset, boolean append) {
        retryOffset = offset;
        retryAppend = append;
        int attempt = ++generation;
        if (pending != null) pending.cancel(true);
        if (!append) { list.setAdapter(null); filter.setVisibility(View.GONE); }
        retry.setVisibility(View.GONE);
        more.setVisibility(View.GONE);
        back.setVisibility(selectedCourse == null ? View.GONE : View.VISIBLE);
        heading.setText(selectedCourse == null ? "Explore student courses" : selectedTitle);
        if (transport == null) {
            status.setText("The private test build has no approved catalog connection.");
            return;
        }
        status.setText("Loading public previews…");
        String course = selectedCourse;
        pending = executor.submit(() -> {
            try {
                CatalogPreview.Page page = CatalogPreview.parsePage(
                    course == null ? transport.courses() : transport.lessons(course, offset), course, offset);
                runOnUiThread(() -> {
                    if (generation != attempt || isFinishing()) return;
                    int previousSize = visibleRows.size();
                    if (!append) displayed.clear();
                    java.util.HashSet<String> seen = new java.util.HashSet<>();
                    for (CatalogPreview.Row row : displayed) seen.add(row.id);
                    for (CatalogPreview.Row row : page.rows) if (seen.add(row.id)) displayed.add(row);
                    nextOffset = page.nextOffset;
                    more.setVisibility(nextOffset == null ? View.GONE : View.VISIBLE);
                    filter.setHint(course == null ? "Search loaded courses" : "Search loaded previews");
                    filter.setContentDescription(course == null ? "Search loaded courses" : "Search loaded previews");
                    filter.setVisibility(displayed.isEmpty() ? View.GONE : View.VISIBLE);
                    renderRows();
                    if (append && visibleRows.size() > previousSize) list.setSelection(previousSize);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (generation != attempt || isFinishing()) return;
                    status.setText(append ? "Unable to load more previews. Existing results remain available; retry when connected." : "Unable to load the catalog. Check your connection and retry.");
                    retry.setVisibility(View.VISIBLE);
                });
            }
        });
    }
}
