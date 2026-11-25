package org.worthkind.studentcreators;

import java.util.Objects;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Memory-only native session boundary for a future hosted Auth adapter.
 * A token is accepted only after the trusted backend verifies the current
 * session and student eligibility. No persistence, URL token, local role
 * inference or replay. The public catalog does not use this component.
 */
public final class MobileSessionBoundary {
    private static final Pattern BEARER = Pattern.compile("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+");
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");
    private final LongSupplier clock;
    private final Verifier verifier;
    private String token, userId;
    private long expiresAt, generation;

    /** The implementation must contact the trusted hosted current-student verifier. */
    public interface Verifier { String verify(String bearer) throws Denied; }
    /** Only a trusted same-origin backend adapter may implement this interface. */
    public interface Read<T> { T read(String bearer) throws Denied; }

    public static final class Denied extends Exception {
        private final int status;
        public Denied(int status) { super("Private access unavailable"); this.status = status; }
        public int status() { return status; }
    }
    public MobileSessionBoundary(LongSupplier clock, Verifier verifier) {
        this.clock = Objects.requireNonNull(clock);
        this.verifier = Objects.requireNonNull(verifier);
    }
    public synchronized void signOut() { generation++; token = null; userId = null; expiresAt = 0; }
    private synchronized long begin() { signOut(); return generation; }

    /** No token is retained if verification fails or the attempt was superseded. */
    public void accept(String candidate, long expiryMillis) throws Denied {
        long attempt = begin();
        if (candidate == null || candidate.length() < 12 || candidate.length() > 8192
            || !BEARER.matcher(candidate).matches() || expiryMillis <= clock.getAsLong()) throw new Denied(401);
        String id = verifier.verify(candidate);
        if (id == null || !ID.matcher(id).matches()) throw new Denied(403);
        synchronized (this) {
            if (attempt != generation || expiryMillis <= clock.getAsLong()) throw new Denied(401);
            token = candidate; userId = id; expiresAt = expiryMillis;
        }
    }
    public synchronized boolean hasSession() {
        if (token == null) return false;
        if (clock.getAsLong() >= expiresAt) { signOut(); return false; }
        return true;
    }
    /** Server checks are repeated, including after offline time. Stale responses are discarded. */
    public <T> T read(Read<T> operation) throws Denied {
        final String bearer, expectedUser;
        final long attempt;
        synchronized (this) {
            if (!hasSession()) throw new Denied(401);
            bearer = token; expectedUser = userId; attempt = generation;
        }
        try {
            if (!expectedUser.equals(verifier.verify(bearer))) throw new Denied(403);
            synchronized (this) {
                if (generation != attempt || !hasSession()) throw new Denied(401);
            }
            T value = operation.read(bearer);
            synchronized (this) {
                if (generation != attempt || !hasSession()) throw new Denied(401);
            }
            return value;
        } catch (Denied e) {
            synchronized (this) {
                if (generation == attempt && (e.status() == 401 || e.status() == 403)) signOut();
            }
            throw e;
        }
    }
}
