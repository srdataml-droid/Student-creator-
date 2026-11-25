package org.worthkind.studentcreators;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.ListView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;

/** Platform-only instrumented tests, no test SDK dependencies or live service calls. */
public final class CatalogSmokeInstrumentation extends Instrumentation {
    private static void check(boolean ok) { if (!ok) throw new AssertionError("Android catalog smoke invariant failed"); }
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
            results.putString("stream","\nANDROID_CATALOG_SMOKE_PASS\n");
            finish(Activity.RESULT_OK, results);
        } catch (Throwable failure) {
            results.putString("stream","\nANDROID_CATALOG_SMOKE_FAIL: "+failure.getClass().getSimpleName()+"\n");
            finish(Activity.RESULT_CANCELED, results);
        } finally {
            if (activity != null) { final Activity screen = activity; runOnMainSync(screen::finish); }
        }
    }
}
