package com.example.logistics.common;

public final class PhoneNumbers {
    private PhoneNumbers() {
    }

    public static String key(String phone) {
        if (phone == null) {
            return null;
        }
        String digits = phone.replaceAll("\\D", "");
        if (digits.startsWith("60") && digits.length() >= 11) {
            digits = "0" + digits.substring(2);
        }
        return digits.length() >= 9 && digits.length() <= 12 ? digits : null;
    }
}
