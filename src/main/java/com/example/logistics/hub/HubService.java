package com.example.logistics.hub;

import com.example.logistics.common.BusinessException;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleStatus;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class HubService {
    private final HubRepository hubs;
    private final VehicleRepository vehicles;
    private final ShipmentRepository shipments;

    public HubService(HubRepository hubs, VehicleRepository vehicles, ShipmentRepository shipments) {
        this.hubs = hubs;
        this.vehicles = vehicles;
        this.shipments = shipments;
    }

    public record CreateHubRequest(
            @NotBlank @Pattern(regexp = "[A-Za-z]{3,5}", message = "Hub code must contain 3-5 English letters") String code,
            @NotBlank(message = "Enter a hub name") @Size(max = 80) String name,
            @NotBlank(message = "Enter a state") @Size(max = 40) String state,
            @NotNull(message = "Select East or Peninsular Malaysia") Landmass landmass,
            @NotNull @DecimalMin("0.5") @DecimalMax("7.5") Double lat,
            @NotNull @DecimalMin("99.5") @DecimalMax("119.5") Double lng) {
    }

    @Transactional(readOnly = true)
    public List<HubView> list() {
        Map<Long, long[]> fleet = new HashMap<>();
        for (Object[] row : vehicles.countByHubAndStatus()) {
            long[] counts = fleet.computeIfAbsent((Long) row[0], k -> new long[2]);
            long n = (Long) row[2];
            counts[0] += n;
            if (row[1] == VehicleStatus.IDLE) {
                counts[1] += n;
            }
        }
        Map<Long, long[]> outbound = new HashMap<>();
        for (Object[] row : shipments.countWaitingByHub(ShipmentStatus.WAITING)) {
            outbound.computeIfAbsent((Long) row[0], k -> new long[2])[0] += (Long) row[1];
        }
        for (Object[] row : shipments.countByOriginAndStatus(ShipmentStatus.MOVING)) {
            outbound.computeIfAbsent((Long) row[0], k -> new long[2])[1] += (Long) row[2];
        }
        Map<Long, Long> inbound = new HashMap<>();
        for (Object[] row : shipments.countByDestination(ShipmentStatus.MOVING)) {
            inbound.put((Long) row[0], (Long) row[1]);
        }
        return hubs.findAllByOrderByIdAsc().stream().map(h -> {
            long[] f = fleet.getOrDefault(h.getId(), new long[2]);
            long[] o = outbound.getOrDefault(h.getId(), new long[2]);
            return HubView.from(h, f[0], f[1], o[0], o[1], inbound.getOrDefault(h.getId(), 0L));
        }).toList();
    }

    @Transactional
    public HubView create(CreateHubRequest request) {
        String code = request.code().trim().toUpperCase(Locale.ROOT);
        if (hubs.existsByCodeIgnoreCase(code)) {
            throw new BusinessException("Hub code " + code + " already exists");
        }
        Hub hub = hubs.save(new Hub(code, request.name().trim(), request.state().trim(), request.landmass(),
                request.lat(), request.lng(), 2));
        return HubView.from(hub, 0, 0, 0, 0, 0);
    }
}
