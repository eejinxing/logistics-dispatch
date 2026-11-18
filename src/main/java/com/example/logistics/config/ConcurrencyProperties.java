package com.example.logistics.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.util.Map;

@Validated
@ConfigurationProperties(prefix = "app.concurrency")
public record ConcurrencyProperties(
        @NotNull @Valid Pool ioPool,
        @NotEmpty Map<String, @Min(1) Integer> bulkheads,
        @NotNull Duration hubLockTimeout,
        @NotNull Duration dashboardTimeout) {

    public record Pool(
            @Min(1) int coreSize,
            @Min(1) int maxSize,
            @Min(0) int queueCapacity,
            @NotNull Duration keepAlive,
            @NotNull Duration shutdownWait) {
    }

    public int totalBulkheadPermits() {
        return bulkheads.values().stream().mapToInt(Integer::intValue).sum();
    }
}
