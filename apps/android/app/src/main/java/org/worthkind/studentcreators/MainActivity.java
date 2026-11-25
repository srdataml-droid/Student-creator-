package org.worthkind.studentcreators;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
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
    private Button retry, back;
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
        retry.setOnClickListener(v -> load());
        layout.addView(retry);
        back = new Button(this);
        back.setText("All courses");
        back.setOnClickListener(v -> { selectedCourse = null; selectedTitle = null; load(); });
        layout.addView(back);
        list = new ListView(this);
        list.setId(R.id.catalog_list);
        layout.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
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
    private void load() {
        int attempt = ++generation;
        if (pending != null) pending.cancel(true);
        list.setAdapter(null);
        retry.setVisibility(View.GONE);
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
                ArrayList<CatalogPreview.Row> rows = CatalogPreview.parse(
                    course == null ? transport.courses() : transport.lessons(course), course);
                ArrayList<String> labels = new ArrayList<>();
                for (CatalogPreview.Row row : rows) labels.add(row.label());
                runOnUiThread(() -> {
                    if (generation != attempt || isFinishing()) return;
                    status.setText(labels.isEmpty() ? "No public previews available." :
                        (course == null ? "Select a course to explore original student work." : "Public previews only."));
                    list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
                    list.setOnItemClickListener((parent, view, position, id) -> {
                        if (course == null) { selectedCourse = rows.get(position).id; selectedTitle = rows.get(position).title; load(); }
                    });
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (generation != attempt || isFinishing()) return;
                    status.setText("Unable to load the catalog. Check your connection and retry.");
                    retry.setVisibility(View.VISIBLE);
                });
            }
        });
    }
}
