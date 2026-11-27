package org.worthkind.studentcreators;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.ListView;
import android.widget.EditText;
import android.os.SystemClock;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;

/** Platform-only instrumented tests, no test SDK dependencies or live service calls. */
public final class CatalogSmokeInstrumentation extends Instrumentation {
    private static void check(boolean ok) { if (!ok) throw new AssertionError("Android catalog smoke invariant failed"); }
    private static final class FixtureConnection extends HttpURLConnection {
        private final int status;
        private final byte[] body;
        FixtureConnection(URL url, int status, String body) {
            super(url); this.status = status; this.body = body.getBytes(StandardCharsets.UTF_8);
        }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() { return status; }
        @Override public String getContentType() { return "application/json"; }
        @Override public long getContentLengthLong() { return body.length; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
    }
    private void awaitUi(String name, BooleanSupplier condition) {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) {
            final boolean[] ready = {false};
            runOnMainSync(() -> ready[0] = condition.getAsBoolean());
            if (ready[0]) return;
            SystemClock.sleep(25);
        }
        throw new AssertionError(name);
    }
    private void exercisePopulatedCatalog(Activity screen, String courseId, String lessonId) throws Exception {
        // Injection exists ONLY in the instrumentation APK. The app still uses
        // its approved HTTPS transport. No synthetic records reach a live service.
        JSONObject other = new JSONObject().put("id","42345678-1234-4234-8234-123456789abc")
            .put("title","Chemistry").put("code","CHM 101");
        String directory = new JSONObject().put("state","ready").put("courses",new JSONArray()
            .put(other).put(new JSONObject().put("id",courseId).put("title","Mathematics").put("code","MTH 101"))).toString();
        JSONObject first = new JSONObject().put("id",lessonId).put("courseId",courseId)
            .put("title","Algebra").put("previewText","Original explanation");
        JSONObject second = new JSONObject().put("id","52345678-1234-4234-8234-123456789abc")
            .put("courseId",courseId).put("title","Geometry").put("previewText","Original shapes");
        String pageOne = new JSONObject().put("items",new JSONArray().put(first)).put("nextOffset",20).toString();
        String pageTwo = new JSONObject().put("items",new JSONArray().put(first).put(second)).put("nextOffset",JSONObject.NULL).toString();
        AtomicInteger nextReads = new AtomicInteger(), coursesReads = new AtomicInteger();
        CatalogTransport source = new CatalogTransport("https://catalog.example.invalid", uri -> {
            if (uri.getPath().equals("/api/courses")) {
                coursesReads.incrementAndGet(); return new FixtureConnection(uri.toURL(),200,directory);
            }
            if (!uri.getQuery().contains("courseId="+courseId)) throw new java.io.IOException("Wrong course");
            if (uri.getQuery().contains("offset=20")) {
                return new FixtureConnection(uri.toURL(),nextReads.incrementAndGet()==1?503:200,pageTwo);
            }
            return new FixtureConnection(uri.toURL(),200,pageOne);
        });
        Field field = MainActivity.class.getDeclaredField("transport");
        field.setAccessible(true);
        Method load = MainActivity.class.getDeclaredMethod("load");
        load.setAccessible(true);
        ListView list = screen.findViewById(R.id.catalog_list);
        EditText search = screen.findViewById(R.id.catalog_filter);
        TextView status = screen.findViewById(R.id.catalog_status);
        android.view.View more = screen.findViewById(R.id.catalog_more), retry = screen.findViewById(R.id.catalog_retry);
        runOnMainSync(() -> {
            try { field.set(screen,source); load.invoke(screen); }
            catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        });
        awaitUi("Directory loaded", () -> list.getCount()==2);
        runOnMainSync(() -> search.setText("mTh"));
        awaitUi("Case-insensitive search", () -> list.getCount()==1 && list.getItemAtPosition(0).toString().contains("Mathematics"));
        runOnMainSync(() -> search.setText("not present"));
        awaitUi("Empty search", () -> list.getCount()==0 && status.getText().toString().contains("No matching"));
        runOnMainSync(() -> { search.setText("MTH"); list.performItemClick(list.getChildAt(0),0,0); });
        awaitUi("Sparse first page", () -> list.getCount()==1 && more.getVisibility()==android.view.View.VISIBLE);
        runOnMainSync(more::performClick);
        awaitUi("Append failure preserves first page", () -> retry.getVisibility()==android.view.View.VISIBLE && list.getCount()==1);
        runOnMainSync(retry::performClick);
        awaitUi("Retry deduplicates and appends", () -> list.getCount()==2 && more.getVisibility()==android.view.View.GONE && retry.getVisibility()==android.view.View.GONE);
        check(nextReads.get()==2);
        runOnMainSync(() -> search.setText("geometry"));
        awaitUi("Preview filtering", () -> list.getCount()==1 && list.getItemAtPosition(0).toString().contains("Geometry"));
        // Inject an actual Back key through the instrumentation connection.
        sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
        awaitUi("Back returns to directory", () -> list.getCount()==2 && coursesReads.get()==2 && search.getText().length()==0);
        System.out.println("ANDROID_POPULATED_CATALOG_UI_PASS");
    }
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle results = new Bundle();
        Activity activity = null;
        try {
            final String courseId = "12345678-1234-4234-8234-123456789abc";
            final String lessonId = "22345678-1234-4234-8234-123456789abc";
            JSONObject course = new JSONObject().put("id", courseId).put("title", "Synthetic course").put("code", "TEST 101");
            ArrayList<CatalogPreview.Row> courses = CatalogPreview.parse(new JSONObject().put("state","ready")
                .put("courses",new JSONArray().put(course).put(course)).toString(),null);
            check(courses.size() == 1);
            check(courses.get(0).label().equals("TEST 101 — Synthetic course"));
            JSONObject lesson = new JSONObject().put("id",lessonId).put("courseId",courseId).put("title","Original preview")
                .put("previewText","Visible text").put("body","PRIVATE_CONTENT_NOT_FOR_RENDERING");
            JSONObject unrelated = new JSONObject().put("id","32345678-1234-4234-8234-123456789abc")
                .put("courseId","42345678-1234-4234-8234-123456789abc").put("title","Wrong course");
            ArrayList<CatalogPreview.Row> previews = CatalogPreview.parse(new JSONObject()
                .put("items",new JSONArray().put(lesson).put(unrelated)).toString(),courseId);
            check(previews.size()==1 && previews.get(0).label().equals("Original preview\nVisible text"));
            try {
                CatalogPreview.parse("{\"state\":\"not_configured\",\"courses\":[]}",null);
                throw new AssertionError("Unconfigured response accepted");
            } catch (org.json.JSONException expected) {}
            JSONArray full = new JSONArray();
            for (int i=0;i<20;i++) full.put(new JSONObject(lesson.toString()).put("id",
                String.format(java.util.Locale.ROOT,"%08x-1234-4234-8234-123456789abc",i+1)));
            JSONObject paged = new JSONObject().put("items",full).put("nextOffset",20);
            CatalogPreview.Page first = CatalogPreview.parsePage(paged.toString(),courseId,0);
            check(first.rows.size()==20 && Integer.valueOf(20).equals(first.nextOffset));
            check(CatalogPreview.parsePage(paged.put("nextOffset",0).toString(),courseId,0).nextOffset==null);
            check(CatalogPreview.parsePage(paged.put("nextOffset","https://example.invalid").toString(),courseId,0).nextOffset==null);
            check(CatalogPreview.parsePage(paged.put("nextOffset",1020).toString(),courseId,1000).nextOffset==null);
            check(Integer.valueOf(20).equals(CatalogPreview.parsePage(new JSONObject()
                .put("items",new JSONArray().put(lesson)).put("nextOffset",20).toString(),courseId,0).nextOffset));
            check(Integer.valueOf(20).equals(CatalogPreview.parsePage(new JSONObject()
                .put("items",new JSONArray()).put("nextOffset",20).toString(),courseId,0).nextOffset));
            Intent intent = new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(intent);
            waitForIdleSync();
            final Activity screen = activity;
            runOnMainSync(() -> {
                TextView title = screen.findViewById(R.id.catalog_heading);
                TextView status = screen.findViewById(R.id.catalog_status);
                ListView list = screen.findViewById(R.id.catalog_list);
                check(title.getText().toString().equals("Explore student courses"));
                check(status.getText().toString().contains("no approved catalog connection"));
                check(list.getAdapter() == null || list.getAdapter().getCount() == 0);
                check(screen.findViewById(R.id.catalog_retry).getVisibility() == android.view.View.GONE);
                check(screen.findViewById(R.id.catalog_more).getVisibility() == android.view.View.GONE);
                check(screen.findViewById(R.id.catalog_filter).getVisibility() == android.view.View.GONE);
            });
            exercisePopulatedCatalog(screen, courseId, lessonId);
            results.putString("stream","\nANDROID_CATALOG_SMOKE_PASS\n");
            finish(Activity.RESULT_OK, results);
        } catch (Throwable failure) {
            results.putString("stream","\nANDROID_CATALOG_SMOKE_FAIL: "+failure.getClass().getSimpleName()+" "+(failure instanceof AssertionError ? failure.getMessage() : "")+"\n");
            finish(Activity.RESULT_CANCELED, results);
        } finally {
            if (activity != null) { final Activity screen = activity; runOnMainSync(screen::finish); }
        }
    }
}
