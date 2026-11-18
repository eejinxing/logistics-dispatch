package com.example.logistics.common;

public class BusinessException extends RuntimeException {
    public BusinessException(String message) {
        super(message, null, false, false);
    }
}
