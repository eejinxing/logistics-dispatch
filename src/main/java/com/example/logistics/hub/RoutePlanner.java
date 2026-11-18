package com.example.logistics.hub;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Component
public class RoutePlanner {
    private final HubRepository hubs;
    private final String gatewayCode;

    public RoutePlanner(HubRepository hubs, @Value("${app.routing.gateway:KUL}") String gatewayCode) {
        this.hubs = hubs;
        this.gatewayCode = gatewayCode;
    }

    public Optional<Hub> gateway() {
        return hubs.findByCodeIgnoreCase(gatewayCode);
    }

    public static Hub nextHop(Hub current, Hub destination, Hub gateway) {
        if (!Routes.requiresAir(current, destination) || gateway == null) {
            return destination;
        }
        if (current.getLandmass() == gateway.getLandmass()) {
            return current.sameAs(gateway) ? destination : gateway;
        }
        return gateway;
    }

    public Hub nextHop(Hub current, Hub destination) {
        return nextHop(current, destination, gateway().orElse(null));
    }

    public List<Hub> path(Hub origin, Hub destination) {
        Hub gateway = gateway().orElse(null);
        List<Hub> path = new ArrayList<>();
        path.add(origin);
        Hub at = origin;
        for (int guard = 0; guard < 4 && !at.sameAs(destination); guard++) {
            at = nextHop(at, destination, gateway);
            path.add(at);
        }
        return path;
    }
}
