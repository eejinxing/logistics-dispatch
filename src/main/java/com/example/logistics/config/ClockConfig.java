package com.example.logistics.config;

import com.example.logistics.simulation.SimulationClock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

@Configuration(proxyBeanMethods = false)
public class ClockConfig {
    public static final ZoneId ZONE = ZoneId.of("Asia/Kuala_Lumpur");

    @Bean
    SimulationClock simulationClock(SimulationProperties props) {
        double scale = props.enabled() ? props.timeScale() : 1.0;
        return new SimulationClock(Instant.now().truncatedTo(ChronoUnit.MINUTES), scale, ZONE);
    }
}
