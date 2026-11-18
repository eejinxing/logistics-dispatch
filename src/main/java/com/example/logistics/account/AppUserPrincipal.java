package com.example.logistics.account;

import com.example.logistics.common.NotFoundException;
import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.io.Serial;
import java.util.Collection;
import java.util.List;

public class AppUserPrincipal implements UserDetails, CredentialsContainer {
    @Serial
    private static final long serialVersionUID = 1L;

    private final long userId;
    private final String username;
    private String password;
    private final Role role;
    private final String displayName;
    private final Long merchantId;
    private final String phoneKey;
    private final boolean enabled;

    public AppUserPrincipal(long userId, String username, String password, Role role, String displayName,
                            Long merchantId, String phoneKey, boolean enabled) {
        this.userId = userId;
        this.username = username;
        this.password = password;
        this.role = role;
        this.displayName = displayName;
        this.merchantId = merchantId;
        this.phoneKey = phoneKey;
        this.enabled = enabled;
    }

    public static AppUserPrincipal from(AppUser u) {
        return new AppUserPrincipal(u.getId(), u.getUsername(), u.getPasswordHash(), u.getRole(), u.getDisplayName(),
                u.getMerchant() == null ? null : u.getMerchant().getId(), u.getPhoneKey(), u.isEnabled());
    }

    public long userId() {
        return userId;
    }

    public Role role() {
        return role;
    }

    public String displayName() {
        return displayName;
    }

    public Long merchantId() {
        return merchantId;
    }

    public String phoneKey() {
        return phoneKey;
    }

    public long requireMerchantId() {
        if (merchantId == null) {
            throw new NotFoundException("This account is not linked to a merchant");
        }
        return merchantId;
    }

    public String requirePhoneKey() {
        if (phoneKey == null) {
            throw new NotFoundException("This account has no linked mobile number");
        }
        return phoneKey;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority(role.authority()));
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public void eraseCredentials() {
        password = null;
    }
}
