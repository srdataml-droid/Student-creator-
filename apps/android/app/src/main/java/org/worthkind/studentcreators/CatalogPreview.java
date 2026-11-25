package org.worthkind.studentcreators;

import java.util.ArrayList;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Decode only the public catalog fields, with strict limits and course isolation. */
final class CatalogPreview {
    private static final Pattern ID = Pattern.compile(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");
    static final class Row {
        final String id, title, code, preview;
        Row(String id, String title, String code, String preview) {
            this.id = id; this.title = title; this.code = code; this.preview = preview;
        }
        String label() {
            return (code.isEmpty() ? "" : code + " — ") + title + (preview.isEmpty() ? "" : "\n" + preview);
        }
    }
    private static String text(JSONObject row, String field, int limit) {
        Object value = row.opt(field);
        if (!(value instanceof String)) return "";
        String text = ((String)value).trim();
        return text.length() > limit ? text.substring(0, limit) : text;
    }
    static final class Page {
        final ArrayList<Row> rows;
        final Integer nextOffset;
        Page(ArrayList<Row> rows, Integer nextOffset) { this.rows = rows; this.nextOffset = nextOffset; }
    }
    static ArrayList<Row> parse(String body, String course) throws JSONException { return parsePage(body, course, 0).rows; }
    static Page parsePage(String body, String course, int offset) throws JSONException {
        if (offset < 0 || offset > 1000 || offset % 20 != 0 || (course == null && offset != 0)) throw new JSONException("Invalid offset");
        JSONObject response = new JSONObject(body);
        if (course == null && !"ready".equals(response.optString("state"))) throw new JSONException("Catalog unavailable");
        if (course != null && !ID.matcher(course).matches()) throw new JSONException("Invalid course");
        JSONArray input = response.getJSONArray(course == null ? "courses" : "items");
        ArrayList<Row> rows = new ArrayList<>();
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < Math.min(input.length(), course == null ? 50 : 20); i++) {
            JSONObject item = input.optJSONObject(i);
            if (item == null) continue;
            String id = text(item, "id", 37), title = text(item, "title", 160);
            if (!ID.matcher(id).matches() || title.isEmpty()) continue;
            if (course != null && !course.equals(text(item, "courseId", 37))) continue;
            if (!seen.add(id)) continue;
            rows.add(new Row(id, title, course == null ? text(item, "code", 32) : "",
                course == null ? "" : text(item, "previewText", 800)));
        }
        Integer next = null;
        if (course != null && input.length() == 20 && offset < 1000) {
            Object raw = response.opt("nextOffset");
            if ((raw instanceof Integer || raw instanceof Long) && ((Number) raw).longValue() == offset + 20L) next = offset + 20;
        }
        return new Page(rows, next);
    }
}
