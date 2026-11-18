package com.example.logistics.web;

import com.example.logistics.dispatch.AutoDispatchResult;
import com.example.logistics.dispatch.DispatchRequest;
import com.example.logistics.dispatch.DispatchService;
import com.example.logistics.dispatch.LaneView;
import com.example.logistics.dispatch.TripView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.concurrent.CompletableFuture;

@RestController
public class DispatchController {
    private final DispatchService dispatch;

    public DispatchController(DispatchService dispatch) {
        this.dispatch = dispatch;
    }

    @GetMapping("/api/dispatch/lanes")
    public List<LaneView> lanes() {
        return dispatch.pendingLanes();
    }

    @PostMapping("/api/dispatch")
    @ResponseStatus(HttpStatus.CREATED)
    public TripView dispatch(@Valid @RequestBody DispatchRequest request) {
        return dispatch.dispatch(request);
    }

    @PostMapping("/api/dispatch/auto")
    public CompletableFuture<AutoDispatchResult> auto() {
        return dispatch.autoDispatch();
    }

    @GetMapping("/api/trips")
    public List<TripView> activeTrips() {
        return dispatch.activeTrips();
    }

    @GetMapping("/api/trips/recent")
    public List<TripView> recent(@RequestParam(defaultValue = "20") int limit) {
        return dispatch.recentArrivals(limit);
    }
}
