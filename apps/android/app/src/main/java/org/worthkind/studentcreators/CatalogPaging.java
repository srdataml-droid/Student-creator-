package org.worthkind.studentcreators;

/** The server's cursor counts database rows, not the number of visible previews. */
final class CatalogPaging {
    static final int PAGE_SIZE = 20, MAX_OFFSET = 1000;
    static Integer nextOffset(int offset, int itemCount, Object raw) {
        if (offset < 0 || offset >= MAX_OFFSET || offset % PAGE_SIZE != 0 ||
            itemCount < 0 || itemCount > PAGE_SIZE) return null;
        if (!(raw instanceof Integer || raw instanceof Long)) return null;
        return ((Number) raw).longValue() == offset + PAGE_SIZE ? offset + PAGE_SIZE : null;
    }
}
