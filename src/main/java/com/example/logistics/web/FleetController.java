package com.example.logistics.web;

import com.example.logistics.dispatch.DispatchService;
import com.example.logistics.dispatch.TripView;
import com.example.logistics.hub.HubService;
import com.example.logistics.hub.HubView;
import com.example.logistics.vehicle.VehicleService;
import com.example.logistics.vehicle.VehicleView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class FleetController {
    private final HubService hubs;
    private final VehicleService vehicles;
    private final DispatchService dispatch;

    public FleetController(HubService hubs, VehicleService vehicles, DispatchService dispatch) {
        this.hubs = hubs;
        this.vehicles = vehicles;
        this.dispatch = dispatch;
    }

    public record MaintenanceRequest(@NotNull Boolean on) {
    }

    public record RelocateRequest(@NotNull(message = "Select a destination hub") Long hubId) {
    }

    @GetMapping("/api/hubs")
    public List<HubView> hubs() {
        return hubs.list();
    }

    @PostMapping("/api/hubs")
    @ResponseStatus(HttpStatus.CREATED)
    public HubView createHub(@Valid @RequestBody HubService.CreateHubRequest request) {
        return hubs.create(request);
    }

    @GetMapping("/api/vehicles")
    public List<VehicleView> vehicles() {
        return vehicles.list();
    }

    @PostMapping("/api/vehicles")
    @ResponseStatus(HttpStatus.CREATED)
    public VehicleView createVehicle(@Valid @RequestBody VehicleService.CreateVehicleRequest request) {
        return vehicles.create(request);
    }

    @PostMapping("/api/vehicles/{id}/maintenance")
    public VehicleView maintenance(@PathVariable long id, @Valid @RequestBody MaintenanceRequest request) {
        return vehicles.setMaintenance(id, request.on());
    }

    @PostMapping("/api/vehicles/{id}/relocate")
    public TripView relocate(@PathVariable long id, @Valid @RequestBody RelocateRequest request) {
        return dispatch.relocate(id, request.hubId());
    }
}
