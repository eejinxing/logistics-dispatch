package com.example.logistics.merchant;

import com.example.logistics.hub.Hub;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "merchants")
public class Merchant {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 12)
    private String code;

    @Column(nullable = false, unique = true, length = 80)
    private String name;

    @Column(length = 60)
    private String contactName;

    @Column(length = 30)
    private String phone;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "default_hub_id")
    private Hub defaultHub;

    private boolean active = true;

    @Column(nullable = false)
    private Instant createdAt;

    protected Merchant() {
    }

    public Merchant(String code, String name, String contactName, String phone, Hub defaultHub, Instant createdAt) {
        this.code = code;
        this.name = name;
        this.contactName = contactName;
        this.phone = phone;
        this.defaultHub = defaultHub;
        this.createdAt = createdAt;
    }

    public void setActive(boolean active) {
        this.active = active;
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

    public String getContactName() {
        return contactName;
    }

    public String getPhone() {
        return phone;
    }

    public Hub getDefaultHub() {
        return defaultHub;
    }

    public boolean isActive() {
        return active;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
