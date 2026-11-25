package org.worthkind.studentcreators;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class CatalogTransportTest {
    private static int checks;
    private static void equal(Object actual, Object expected) {
        if (!expected.equals(actual)) throw new AssertionError(actual + " != " + expected);
        checks++;
    }
    private static void rejects(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { checks++; return; }
        throw new AssertionError("Expected rejection");
    }
    private static final class FakeConnection extends HttpURLConnection {
        private final int responseStatus;
        private final String responseType;
        private final byte[] body;
        boolean disconnected;
        FakeConnection(int status, String type, byte[] data) throws Exception {
            super(new URL("https://catalog.example.invalid/api/courses"));
            responseStatus = status; responseType = type; body = data;
        }
        @Override public void connect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void disconnect() { disconnected = true; }
        @Override public int getResponseCode() { return responseStatus; }
        @Override public String getContentType() { return responseType; }
        @Override public long getContentLengthLong() { return body.length; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
    }
    private static void refuses(FakeConnection c) throws Exception {
        try {
            new CatalogTransport("https://catalog.example.invalid", uri -> c).courses();
            throw new AssertionError("Invalid HTTP response accepted");
        } catch (IOException expected) { checks++; }
        equal(c.disconnected, true);
    }
    public static void main(String[] args) throws Exception {
        CatalogTransport transport = new CatalogTransport("https://catalog.example.invalid");
        equal(transport.coursesUri().toString(), "https://catalog.example.invalid/api/courses");
        equal(transport.lessonsUri("12345678-1234-4234-8234-123456789abc").toString(),
            "https://catalog.example.invalid/api/lessons?courseId=12345678-1234-4234-8234-123456789abc&limit=20");
        equal(transport.lessonsUri("12345678-1234-4234-8234-123456789abc", 20).toString(),
            "https://catalog.example.invalid/api/lessons?courseId=12345678-1234-4234-8234-123456789abc&limit=20&offset=20");
        for (int offset : new int[]{-20,1,1020}) rejects(() -> transport.lessonsUri("12345678-1234-4234-8234-123456789abc", offset));
        for (String origin : new String[]{"", "http://catalog.example.invalid", "https://user@catalog.example.invalid",
                "https://catalog.example.invalid:444", "https://catalog.example.invalid/path",
                "https://catalog.example.invalid?token=x", "https://catalog.example.invalid#fragment", "https://localhost"})
            rejects(() -> new CatalogTransport(origin));
        for (String id : new String[]{"", "../", "x&limit=100", "https://example.invalid", "00000000-0000-0000-0000-000000000000"})
            rejects(() -> transport.lessonsUri(id));
        equal(CatalogTransport.readBounded(new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8))), "{}");
        equal(CatalogTransport.readBounded(new ByteArrayInputStream(new byte[CatalogTransport.MAX_BYTES])).length(), CatalogTransport.MAX_BYTES);
        try {
            CatalogTransport.readBounded(new ByteArrayInputStream(new byte[CatalogTransport.MAX_BYTES + 1]));
            throw new AssertionError("Oversize response accepted");
        } catch (IOException expected) { checks++; }
        FakeConnection ok = new FakeConnection(200, "application/json; charset=utf-8", "{}".getBytes(StandardCharsets.UTF_8));
        equal(new CatalogTransport("https://catalog.example.invalid", uri -> ok).courses(), "{}");
        equal(ok.getRequestMethod(), "GET");
        equal(ok.getInstanceFollowRedirects(), false);
        equal(ok.getUseCaches(), false);
        equal(ok.getRequestProperty("Accept"), "application/json");
        equal(ok.getRequestProperty("Cache-Control"), "no-store");
        equal(ok.getConnectTimeout(), 8000);
        equal(ok.getReadTimeout(), 8000);
        equal(ok.disconnected, true);
        if (ok.getRequestProperty("Authorization") != null || ok.getRequestProperty("Cookie") != null)
            throw new AssertionError("Anonymous request supplied credentials");
        checks++;
        refuses(new FakeConnection(302, "application/json", new byte[0]));
        refuses(new FakeConnection(401, "application/json", new byte[0]));
        refuses(new FakeConnection(503, "application/json", new byte[0]));
        refuses(new FakeConnection(200, "text/html", new byte[0]));
        refuses(new FakeConnection(200, "application/json", new byte[CatalogTransport.MAX_BYTES + 1]));
        System.out.println("Android catalog JVM checks passed: " + checks);
    }
}
