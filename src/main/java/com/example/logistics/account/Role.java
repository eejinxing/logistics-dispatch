package com.example.logistics.account;

public enum Role {
    ADMIN("Administrator", "/"),
    MERCHANT("Merchant", "/merchant.html"),
    CUSTOMER("Recipient", "/customer.html");

    private final String label;
    private final String home;

    Role(String label, String home) {
        this.label = label;
        this.home = home;
    }

    public String label() {
        return label;
    }

    public String home() {
        return home;
    }

    public String authority() {
        return "ROLE_" + name();
    }
}
