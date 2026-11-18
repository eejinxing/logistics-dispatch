package com.example.logistics.dispatch;

import com.example.logistics.common.BusinessException;
import com.example.logistics.geo.Direction;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DispatchRulesTest {
    private static final Instant NOW = Instant.parse("2026-11-17T08:00:00Z");
    private static final Duration WAIT = Duration.ofHours(3);
    private final Vehicle van = new Vehicle("VAN 1", VehicleType.VAN, 1_000, "d", null, null);
    private final Vehicle lorry = new Vehicle("LOR 1", VehicleType.LORRY, 5_000, "d", null, null);

    private static Shipment shipment(Priority priority, Duration age) {
        return new Shipment("MY1", "s", "r", null, null, null, null, 10, priority, Direction.N, 100,
                BigDecimal.TEN, NOW.minus(age), NOW.plus(Duration.ofDays(1)), null);
    }

    @Test
    void laneBecomesOverdueAfterTheConsolidationWindowAndExpressAfterHalf() {
        assertThat(DispatchRules.isOverdue(List.of(shipment(Priority.STANDARD, Duration.ofHours(2))), NOW, WAIT)).isFalse();
        assertThat(DispatchRules.isOverdue(List.of(shipment(Priority.STANDARD, Duration.ofHours(4))), NOW, WAIT)).isTrue();
        assertThat(DispatchRules.isOverdue(List.of(shipment(Priority.EXPRESS, Duration.ofHours(2))), NOW, WAIT)).isTrue();
    }

    @Test
    void picksTheVehicleThatIsFilledBest() {
        List<Vehicle> both = List.of(van, lorry);
        assertThat(DispatchRules.chooseVehicle(both, 900, false, 0.6)).isSameAs(van);
        assertThat(DispatchRules.chooseVehicle(both, 1_200, false, 0.6)).isSameAs(van);
        assertThat(DispatchRules.chooseVehicle(both, 4_000, false, 0.6)).isSameAs(lorry);
    }

    @Test
    void waitsForMoreFreightUnlessTheLaneIsOverdue() {
        List<Vehicle> both = List.of(van, lorry);
        assertThat(DispatchRules.chooseVehicle(both, 200, false, 0.6)).isNull();
        assertThat(DispatchRules.chooseVehicle(both, 200, true, 0.6)).isSameAs(van);
        assertThat(DispatchRules.chooseVehicle(both, 7_000, true, 0.6)).isSameAs(lorry);
    }

    @Test
    void shipmentStatusMachineRejectsIllegalJumps() {
        Shipment s = shipment(Priority.STANDARD, Duration.ZERO);
        assertThat(ShipmentStatus.CREATED.canMoveTo(ShipmentStatus.ASSIGNED)).isTrue();
        assertThat(ShipmentStatus.DELIVERED.isTerminal()).isTrue();
        assertThatThrownBy(() -> s.moveTo(ShipmentStatus.DELIVERED, NOW)).isInstanceOf(BusinessException.class);
        s.moveTo(ShipmentStatus.CANCELLED, NOW);
        assertThatThrownBy(() -> s.moveTo(ShipmentStatus.ASSIGNED, NOW)).isInstanceOf(BusinessException.class);
    }
}
