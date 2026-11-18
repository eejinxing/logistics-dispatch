package com.example.logistics.seed;

import com.example.logistics.dashboard.DashboardService;
import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.vehicle.VehicleService;
import com.example.logistics.vehicle.VehicleView;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "app.simulation.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:seeded-dashboard;DB_CLOSE_DELAY=-1"
})
class DataSeederTest {
    @Autowired
    private DashboardService dashboard;
    @Autowired
    private VehicleService vehicles;
    @Autowired
    private TripRepository trips;

    @Test
    void pendingDemoShipmentsHaveFleetDataAndHistoricalTripsDoNotOccupyVehicles() {
        var fleet = vehicles.list();
        var alerts = dashboard.summary(null, "active").join().alerts();

        assertThat(alerts.latestExceptions()).isNotEmpty().allSatisfy(shipment -> {
            assertThat(shipment.tripCode()).isNotBlank();
            assertThat(fleet).extracting(VehicleView::plateNo).contains(shipment.plateNo());
        });
        assertThat(fleet).anySatisfy(vehicle -> {
            assertThat(vehicle.refrigerated()).isTrue();
            assertThat(vehicle.heavyDuty()).isTrue();
            assertThat(vehicle.nextServiceOn()).isNotNull();
            assertThat(vehicle.fuelScore()).isBetween(0, 10);
            assertThat(vehicle.assignedDrivers()).hasSizeBetween(6, 7)
                    .allSatisfy(driver -> assertThat(driver.portrait()).isBetween(0, 15));
        });
        assertThat(trips.findWithDetailsByStatusIn(java.util.EnumSet.of(TripStatus.ARRIVED))).isNotEmpty();
        assertThat(fleet).extracting(VehicleView::tripCode).containsOnlyNulls();
    }
}
