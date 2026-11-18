package com.example.logistics.account;

import com.example.logistics.common.BusinessException;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.common.PhoneNumbers;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.simulation.SimulationClock;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

@Service
public class AccountService {
    private final AppUserRepository users;
    private final ShipmentRepository shipments;
    private final PasswordEncoder encoder;
    private final SimulationClock clock;

    public AccountService(AppUserRepository users, ShipmentRepository shipments, PasswordEncoder encoder,
                          SimulationClock clock) {
        this.users = users;
        this.shipments = shipments;
        this.encoder = encoder;
        this.clock = clock;
    }

    public record RegisterCustomerRequest(
            @NotBlank(message = "Enter a username")
            @Pattern(regexp = "[A-Za-z0-9_.-]{3,30}", message = "Username must contain 3-30 letters, digits, underscores, periods, or hyphens") String username,
            @NotBlank(message = "Enter a password") @Size(min = 6, max = 64, message = "Password must be at least 6 characters long") String password,
            @NotBlank(message = "Enter a name") @Size(max = 40) String displayName,
            @NotBlank(message = "Enter a mobile number") @Size(max = 30) String phone,
            @NotBlank(message = "Enter a tracking number addressed to you") @Size(max = 20) String trackingNo) {
    }

    @Transactional
    public AccountView registerCustomer(RegisterCustomerRequest request) {
        String username = request.username().trim();
        if (users.existsByUsernameIgnoreCase(username)) {
            throw new BusinessException("Username " + username + " is already in use");
        }
        String phoneKey = PhoneNumbers.key(request.phone());
        if (phoneKey == null) {
            throw new BusinessException("Invalid mobile number");
        }
        if (users.existsByPhoneKey(phoneKey)) {
            throw new BusinessException("This mobile number is already registered. Sign in to your account.");
        }
        String trackingNo = request.trackingNo().trim().toUpperCase(Locale.ROOT);
        if (!shipments.existsByTrackingNoAndReceiverPhoneKey(trackingNo, phoneKey)) {
            throw new BusinessException("The tracking number does not match the mobile number. Enter a shipment addressed to that number.");
        }
        AppUser user = users.save(new AppUser(username, encoder.encode(request.password()), Role.CUSTOMER,
                request.displayName().trim(), null, request.phone().trim(), clock.instant()));
        return AccountView.from(user);
    }

    @Transactional(readOnly = true)
    public List<AccountView> list() {
        return users.findAllWithMerchant().stream().map(AccountView::from).toList();
    }

    @Transactional
    public AccountView setEnabled(long id, boolean enabled) {
        AppUser user = users.findById(id).orElseThrow(() -> new NotFoundException("Account not found: " + id));
        if (user.getRole() == Role.ADMIN && !enabled) {
            throw new BusinessException("Administrator accounts cannot be disabled");
        }
        user.setEnabled(enabled);
        return AccountView.from(user);
    }

    @Transactional
    public void recordLogin(long userId) {
        users.findById(userId).ifPresent(u -> u.recordLogin(clock.instant()));
    }
}
