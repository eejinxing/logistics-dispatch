package com.example.logistics.hub;

import com.example.logistics.geo.Direction;
import com.example.logistics.geo.Geo;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "hubs")
public class Hub {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 8)
    private String code;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(nullable = false, length = 40)
    private String state;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Landmass landmass;

    private double lat;
    private double lng;

    private int demandWeight;

    protected Hub() {
    }

    public Hub(String code, String name, String state, Landmass landmass, double lat, double lng, int demandWeight) {
        this.code = code;
        this.name = name;
        this.state = state;
        this.landmass = landmass;
        this.lat = lat;
        this.lng = lng;
        this.demandWeight = demandWeight;
    }

    public double greatCircleKmTo(Hub other) {
        return Geo.distanceKm(lat, lng, other.lat, other.lng);
    }

    public Direction directionTo(Hub other) {
        return Geo.direction(lat, lng, other.lat, other.lng);
    }

    public boolean sameAs(Hub other) {
        return other != null && id != null && id.equals(other.id);
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public String getState() {
        return state;
    }

    public Landmass getLandmass() {
        return landmass;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }

    public int getDemandWeight() {
        return demandWeight;
    }
}
