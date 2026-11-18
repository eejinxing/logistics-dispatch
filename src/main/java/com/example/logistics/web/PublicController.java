package com.example.logistics.web;

import com.example.logistics.concurrent.RateLimiter;
import com.example.logistics.hub.HubRef;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.simulation.SimulationClock;
import com.example.logistics.tracking.TrackingService;
import com.example.logistics.tracking.TrackingView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@Validated
public class PublicController {
    private final TrackingService tracking;
    private final HubRepository hubs;
    private final SimulationClock clock;
    private final RateLimiter lookups = new RateLimiter(30, 60_000);

    public PublicController(TrackingService tracking, HubRepository hubs, SimulationClock clock) {
        this.tracking = tracking;
        this.hubs = hubs;
        this.clock = clock;
    }

    @GetMapping("/api/public/track/{trackingNo}")
    public TrackingView track(@PathVariable @Pattern(regexp = "[A-Za-z0-9]{6,20}", message = "Invalid tracking number format")
                              String trackingNo, HttpServletRequest request) {
        lookups.check(request.getRemoteAddr());
        return tracking.forPublic(trackingNo);
    }

    @GetMapping("/api/public/clock")
    public Map<String, Object> clock() {
        return Map.of("now", clock.instant(), "scale", clock.scale(), "paused", clock.isPaused(),
                "zone", clock.getZone().getId());
    }

    @GetMapping("/api/network/hubs")
    public List<HubRef> hubs() {
        return hubs.findAllByOrderByIdAsc().stream().map(HubRef::from).toList();
    }
}
