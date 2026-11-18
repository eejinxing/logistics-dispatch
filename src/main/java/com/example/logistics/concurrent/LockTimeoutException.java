package com.example.logistics.concurrent;

public class LockTimeoutException extends RuntimeException {
    public LockTimeoutException(String lockName, Object key, Throwable cause) {
        super("Timed out waiting for " + lockName + " lock on '" + key + "'", cause, false, false);
    }
}
