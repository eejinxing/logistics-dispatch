package com.example.logistics.account;

import com.example.logistics.config.AdminProperties;
import com.example.logistics.simulation.SimulationClock;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@Order(0)
public class AccountBootstrap implements ApplicationRunner {
    private final AdminProperties admin;
    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final TransactionTemplate tx;
    private final SimulationClock clock;

    public AccountBootstrap(AdminProperties admin, AppUserRepository users, PasswordEncoder encoder,
                            TransactionTemplate tx, SimulationClock clock) {
        this.admin = admin;
        this.users = users;
        this.encoder = encoder;
        this.tx = tx;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        tx.executeWithoutResult(status -> users.findByUsernameIgnoreCase(admin.username()).ifPresentOrElse(
                existing -> {
                    if (!existing.isAdministrator()) {
                        throw new IllegalStateException("ADMIN_USERNAME already belongs to a non-administrator account");
                    }
                    if (!encoder.matches(admin.password(), existing.getPasswordHash())) {
                        existing.changePassword(encoder.encode(admin.password()));
                    }
                },
                () -> users.save(new AppUser(admin.username(), encoder.encode(admin.password()),
                        "System administrator", clock.instant()))));
    }
}
