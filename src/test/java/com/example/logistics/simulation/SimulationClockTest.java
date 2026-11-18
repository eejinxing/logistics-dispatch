package com.example.logistics.simulation;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class SimulationClockTest {
    private static final long SECOND = 1_000_000_000L;
    private final Instant start = Instant.parse("2026-01-01T00:00:00Z");
    private final AtomicLong nanos = new AtomicLong();
    private final SimulationClock clock = new SimulationClock(start, 360, ZoneOffset.UTC, nanos::get);

    @Test
    void runsScaleTimesFasterThanRealTime() {
        nanos.addAndGet(SECOND);
        assertThat(clock.instant()).isEqualTo(start.plusSeconds(360));
    }

    @Test
    void pauseFreezesTimeAndChangingSpeedNeverJumpsBack() {
        nanos.addAndGet(SECOND);
        clock.setPaused(true);
        nanos.addAndGet(5 * SECOND);
        assertThat(clock.instant()).isEqualTo(start.plusSeconds(360));

        clock.setPaused(false);
        clock.setScale(60);
        nanos.addAndGet(SECOND);
        assertThat(clock.instant()).isEqualTo(start.plusSeconds(420));

        clock.advance(Duration.ofHours(1));
        assertThat(clock.instant()).isEqualTo(start.plusSeconds(420 + 3600));
    }
}
