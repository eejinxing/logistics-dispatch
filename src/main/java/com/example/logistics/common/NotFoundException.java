package com.example.logistics.common;

public class NotFoundException extends RuntimeException {
    public NotFoundException(String message) {
        super(message, null, false, false);
    }
}
