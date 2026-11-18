package com.example.logistics.geo;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GeoTest {
    private static final double KUL_LAT = 3.1390;
    private static final double KUL_LNG = 101.6869;

    @Test
    void lanesFromKualaLumpurPointTheRightWay() {
        assertThat(Geo.direction(KUL_LAT, KUL_LNG, 5.4141, 100.3288)).isEqualTo(Direction.NW);
        assertThat(Geo.direction(KUL_LAT, KUL_LNG, 1.4927, 103.7414)).isEqualTo(Direction.SE);
        assertThat(Geo.direction(KUL_LAT, KUL_LNG, 1.5535, 110.3593)).isEqualTo(Direction.E);
        assertThat(Geo.direction(KUL_LAT, KUL_LNG, 6.1254, 102.2381)).isEqualTo(Direction.N);
    }

    @Test
    void bearingsSnapToTheNearestCompassPoint() {
        assertThat(Direction.fromBearing(359)).isEqualTo(Direction.N);
        assertThat(Direction.fromBearing(22.4)).isEqualTo(Direction.N);
        assertThat(Direction.fromBearing(22.6)).isEqualTo(Direction.NE);
        assertThat(Direction.fromBearing(180)).isEqualTo(Direction.S);
        assertThat(Direction.fromBearing(-90)).isEqualTo(Direction.W);
    }

    @Test
    void haversineDistanceIsRealistic() {
        assertThat(Geo.distanceKm(KUL_LAT, KUL_LNG, 5.4141, 100.3288)).isBetween(280.0, 310.0);
    }
}
