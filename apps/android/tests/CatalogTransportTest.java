package org.worthkind.studentcreators;
import java.io.ByteArrayInputStream;
import java.io.IOException;
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
    public static void main(String[] args) throws Exception {
        CatalogTransport transport = new CatalogTransport("https://catalog.example.invalid");
        equal(transport.coursesUri().toString(), "https://catalog.example.invalid/api/courses");
        equal(transport.lessonsUri("12345678-1234-4234-8234-123456789abc").toString(),
            "https://catalog.example.invalid/api/lessons?courseId=12345678-1234-4234-8234-123456789abc&limit=20");
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
        System.out.println("Android catalog JVM checks passed: " + checks);
    }
}
