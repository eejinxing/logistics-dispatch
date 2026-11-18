package com.example.logistics.live;

import java.time.Instant;
import java.util.Map;

public record LiveEvent(String type, String level, String message, Map<String, Object> data, Instant at) {
    public static LiveEvent info(String type, String message, Map<String, Object> data, Instant at) {
        return new LiveEvent(type, "info", message, data, at);
    }

    public static LiveEvent success(String type, String message, Map<String, Object> data, Instant at) {
        return new LiveEvent(type, "success", message, data, at);
    }

    public static LiveEvent warn(String type, String message, Map<String, Object> data, Instant at) {
        return new LiveEvent(type, "warn", message, data, at);
    }
}
