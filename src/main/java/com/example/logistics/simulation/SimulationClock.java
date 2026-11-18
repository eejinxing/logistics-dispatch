package com.example.logistics.simulation;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;

public final class SimulationClock extends Clock {
    private record Anchor(long realNanos, Instant simInstant, double scale, boolean paused) {
        Instant at(long nanos) {
            if (paused || scale == 0) {
                return simInstant;
            }
            return simInstant.plusNanos((long) ((nanos - realNanos) * scale));
        }
    }

    private final AtomicReference<Anchor> anchor;
    private final ZoneId zone;
    private final LongSupplier nanoTime;

    public SimulationClock(Instant start, double scale, ZoneId zone) {
        this(start, scale, zone, System::nanoTime);
    }

    SimulationClock(Instant start, double scale, ZoneId zone, LongSupplier nanoTime) {
        this(new AtomicReference<>(new Anchor(nanoTime.getAsLong(), start, scale, false)), zone, nanoTime);
    }

    private SimulationClock(AtomicReference<Anchor> anchor, ZoneId zone, LongSupplier nanoTime) {
        this.anchor = anchor;
        this.zone = zone;
        this.nanoTime = nanoTime;
    }

    @Override
    public Instant instant() {
        return anchor.get().at(nanoTime.getAsLong());
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new SimulationClock(anchor, zone, nanoTime);
    }

    public void setScale(double scale) {
        if (scale < 0) {
            throw new IllegalArgumentException("scale must be >= 0");
        }
        anchor.updateAndGet(a -> {
            long now = nanoTime.getAsLong();
            return new Anchor(now, a.at(now), scale, a.paused());
        });
    }

    public void setPaused(boolean paused) {
        anchor.updateAndGet(a -> {
            long now = nanoTime.getAsLong();
            return new Anchor(now, a.at(now), a.scale(), paused);
        });
    }

    public void advance(java.time.Duration by) {
        anchor.updateAndGet(a -> {
            long now = nanoTime.getAsLong();
            return new Anchor(now, a.at(now).plus(by), a.scale(), a.paused());
        });
    }

    public double scale() {
        return anchor.get().scale();
    }

    public boolean isPaused() {
        return anchor.get().paused();
    }
}
