package org.worthkind.studentcreators;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicInteger;

public final class MobileSessionBoundaryTest {
    private static int checks;
    private static final String TOKEN = "eyJtest.synthetic.signature";
    private static final String ID = "12345678-1234-4234-8234-123456789abc";
    private static final String OTHER = "22345678-1234-4234-8234-123456789abc";
    private interface Task { void run() throws Exception; }
    private static void check(boolean value) {
        if (!value) throw new AssertionError("Session invariant failed");
        checks++;
    }
    private static void denied(int status, Task task) throws Exception {
        try { task.run(); } catch (MobileSessionBoundary.Denied e) { check(e.status() == status); return; }
        throw new AssertionError("Unexpected private access");
    }
    public static void main(String[] args) throws Exception {
        AtomicLong clock = new AtomicLong(1000);
        AtomicInteger calls = new AtomicInteger();
        AtomicInteger status = new AtomicInteger(200);
        String[] user = {ID};
        MobileSessionBoundary session = new MobileSessionBoundary(clock::get, bearer -> {
            check(TOKEN.equals(bearer));
            calls.incrementAndGet();
            if (status.get() != 200) throw new MobileSessionBoundary.Denied(status.get());
            return user[0];
        });
        check(!session.hasSession());
        denied(401, () -> session.read(b -> { throw new AssertionError("Must not call"); }));
        denied(401, () -> session.accept("bad token", 2000));
        denied(401, () -> session.accept(TOKEN, 1000));
        check(calls.get() == 0);
        session.accept(TOKEN, 2000);
        check(session.hasSession());
        check("safe-result".equals(session.read(b -> "safe-result")));
        check(calls.get() == 2);
        status.set(503);
        denied(503, () -> session.read(b -> { throw new AssertionError("Must not call"); }));
        check(session.hasSession());
        status.set(401);
        denied(401, () -> session.read(b -> { throw new AssertionError("Must not call"); }));
        check(!session.hasSession());
        status.set(200);
        session.accept(TOKEN, 2000);
        user[0] = OTHER;
        denied(403, () -> session.read(b -> { throw new AssertionError("Must not call"); }));
        check(!session.hasSession());
        user[0] = ID;
        session.accept(TOKEN, 2000);
        denied(401, () -> session.read(b -> { session.signOut(); return "stale-private-result"; }));
        check(!session.hasSession());
        session.accept(TOKEN, 2000);
        clock.set(2000);
        check(!session.hasSession());
        denied(401, () -> session.read(b -> { throw new AssertionError("Must not call"); }));
        // A new instance models process death: no session is restored from disk.
        check(!new MobileSessionBoundary(clock::get, b -> ID).hasSession());
        System.out.println("Android mobile session JVM checks passed: " + checks);
    }
}
