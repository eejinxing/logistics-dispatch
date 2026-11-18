package com.example.logistics.concurrent;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

public final class KeyedLocks<K> {
    private final String name;
    private final Duration timeout;
    private final ConcurrentMap<K, ReentrantLock> locks = new ConcurrentHashMap<>();

    public KeyedLocks(String name, Duration timeout) {
        this.name = name;
        this.timeout = timeout;
    }

    public <T> T withLock(K key, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(key, k -> new ReentrantLock(true));
        boolean acquired;
        try {
            acquired = lock.tryLock(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LockTimeoutException(name, key, e);
        }
        if (!acquired) {
            throw new LockTimeoutException(name, key, null);
        }
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }

    public void withLock(K key, Runnable action) {
        withLock(key, () -> {
            action.run();
            return null;
        });
    }

    public boolean tryWithLock(K key, Runnable action) {
        ReentrantLock lock = locks.computeIfAbsent(key, k -> new ReentrantLock(true));
        if (!lock.tryLock()) {
            return false;
        }
        try {
            action.run();
            return true;
        } finally {
            lock.unlock();
        }
    }

    public boolean isHeldByCurrentThread(K key) {
        ReentrantLock lock = locks.get(key);
        return lock != null && lock.isHeldByCurrentThread();
    }
}
