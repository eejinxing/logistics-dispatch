package com.example.logistics.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;

@Entity
@Table(name = "app_users")
public class AppUser {
    public static final String ADMIN_ROLE = "ADMIN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 40)
    private String username;

    @Column(nullable = false, length = 100)
    private String passwordHash;

    @Column(nullable = false, length = 12)
    private String role = ADMIN_ROLE;

    @Column(nullable = false, length = 80)
    private String displayName;

    private boolean enabled = true;

    @Column(nullable = false)
    private Instant createdAt;

    @Version
    private long version;

    protected AppUser() {
    }

    public AppUser(String username, String passwordHash, String displayName, Instant createdAt) {
        this.username = username;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.createdAt = createdAt;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getUsername() {
        return username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public boolean isAdministrator() {
        return ADMIN_ROLE.equals(role);
    }

    public boolean isEnabled() {
        return enabled;
    }
}
