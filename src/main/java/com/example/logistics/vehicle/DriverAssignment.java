package com.example.logistics.vehicle;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

@Embeddable
public class DriverAssignment {
    @Column(nullable = false, length = 60)
    private String name;
    private Integer portrait;

    protected DriverAssignment() {
    }

    public DriverAssignment(String name, Integer portrait) {
        this.name = name;
        this.portrait = portrait;
    }

    public String getName() {
        return name;
    }

    public Integer getPortrait() {
        return portrait;
    }
}
