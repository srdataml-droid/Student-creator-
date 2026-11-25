package org.worthkind.studentcreators;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/** Anonymous, read-only transport. Never imports sessions, secrets or payment URLs. */
public final class CatalogTransport {
    static final int MAX_BYTES = 262144;
    private static final Pattern ID = Pattern.compile(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");
    interface ConnectionFactory { HttpURLConnection open(URI destination) throws IOException; }
    private final URI origin;
    private final ConnectionFactory connections;
    public CatalogTransport(String configuredOrigin) {
        this(configuredOrigin, destination -> (HttpURLConnection) destination.toURL().openConnection());
    }
    CatalogTransport(String configuredOrigin, ConnectionFactory connections) {
        this.connections = java.util.Objects.requireNonNull(connections);
        origin = URI.create(configuredOrigin);
        String host = origin.getHost();
        if (!"https".equals(origin.getScheme()) || host == null || !host.contains(".")
            || origin.getPort() != -1 || origin.getRawUserInfo() != null
            || !(origin.getRawPath().isEmpty() || "/".equals(origin.getRawPath()))
            || origin.getRawQuery() != null || origin.getRawFragment() != null) {
            throw new IllegalArgumentException("Invalid catalog origin");
        }
    }
    URI coursesUri() { return origin.resolve("/api/courses"); }
    URI lessonsUri(String courseId) {
        if (courseId == null || !ID.matcher(courseId).matches())
            throw new IllegalArgumentException("Invalid course identifier");
        return origin.resolve("/api/lessons?courseId=" + courseId + "&limit=20");
    }
    public String courses() throws IOException { return read(coursesUri()); }
    public String lessons(String id) throws IOException { return read(lessonsUri(id)); }
    private String read(URI destination) throws IOException {
        HttpURLConnection c = connections.open(destination);
        try {
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("GET");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Cache-Control", "no-store");
            int status = c.getResponseCode();
            String type = c.getContentType();
            if (status != 200 || type == null ||
                !type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT).equals("application/json"))
                throw new IOException("Catalog unavailable");
            if (c.getContentLengthLong() > MAX_BYTES) throw new IOException("Catalog response too large");
            try (InputStream in = c.getInputStream()) { return readBounded(in); }
        } finally { c.disconnect(); }
    }
    static String readBounded(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        for (int n; (n = in.read(buffer)) != -1;) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
            if (n > MAX_BYTES - out.size()) throw new IOException("Catalog response too large");
            out.write(buffer, 0, n);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
