package com.example.logistics.web;

import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import com.example.logistics.simulation.SimulationClock;
import com.example.logistics.simulation.SimulationSettings;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {
    private final SimulationClock clock;
    private final SimulationSettings settings;
    private final LiveEventHub live;

    public SimulationController(SimulationClock clock, SimulationSettings settings, LiveEventHub live) {
        this.clock = clock;
        this.settings = settings;
        this.live = live;
    }

    public record SimulationState(Instant now, String zone, double scale, boolean paused, boolean engineEnabled,
                                  boolean autoGenerate, boolean autoDispatch, int subscribers) {
    }

    public record SimulationUpdate(
            @DecimalMin("1") @DecimalMax("7200") Double scale,
            Boolean paused,
            Boolean autoGenerate,
            Boolean autoDispatch,
            @Min(1) @Max(24 * 60) Integer advanceMinutes) {
    }

    @GetMapping
    public SimulationState state() {
        return new SimulationState(clock.instant(), clock.getZone().getId(), clock.scale(), clock.isPaused(),
                settings.engineEnabled(), settings.autoGenerate(), settings.autoDispatch(), live.subscribers());
    }

    @PatchMapping
    public SimulationState update(@Valid @RequestBody SimulationUpdate update) {
        List<String> changes = new ArrayList<>();
        if (update.scale() != null) {
            clock.setScale(update.scale());
            changes.add("Speed ×" + Math.round(update.scale()));
        }
        if (update.paused() != null) {
            clock.setPaused(update.paused());
            changes.add(update.paused() ? "Paused" : "Resumed");
        }
        if (update.advanceMinutes() != null) {
            clock.advance(Duration.ofMinutes(update.advanceMinutes()));
            changes.add("Advanced by " + update.advanceMinutes() + " minutes");
        }
        if (update.autoGenerate() != null) {
            settings.setAutoGenerate(update.autoGenerate());
            changes.add(update.autoGenerate() ? "Enabled automatic orders" : "Disabled automatic orders");
        }
        if (update.autoDispatch() != null) {
            settings.setAutoDispatch(update.autoDispatch());
            changes.add(update.autoDispatch() ? "Enabled automatic dispatch" : "Disabled automatic dispatch");
        }
        SimulationState state = state();
        if (!changes.isEmpty()) {
            live.publish(LiveEvent.info("clock", "Simulation settings: " + String.join(", ", changes),
                    Map.of("scale", state.scale(), "paused", state.paused()), state.now()));
        }
        return state;
    }
}
