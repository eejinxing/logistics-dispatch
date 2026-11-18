package com.example.logistics.simulation;

import com.example.logistics.config.SimulationProperties;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class SimulationSettings {
    private final boolean engineEnabled;
    private final AtomicBoolean autoGenerate;
    private final AtomicBoolean autoDispatch;

    public SimulationSettings(SimulationProperties props) {
        this.engineEnabled = props.enabled();
        this.autoGenerate = new AtomicBoolean(props.autoGenerate());
        this.autoDispatch = new AtomicBoolean(props.autoDispatch());
    }

    public boolean engineEnabled() {
        return engineEnabled;
    }

    public boolean autoGenerate() {
        return autoGenerate.get();
    }

    public void setAutoGenerate(boolean on) {
        autoGenerate.set(on);
    }

    public boolean autoDispatch() {
        return autoDispatch.get();
    }

    public void setAutoDispatch(boolean on) {
        autoDispatch.set(on);
    }
}
