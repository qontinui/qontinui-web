"use client";

import * as React from "react";
import { ExecutionResultsDisplay } from "./ExecutionResultsDisplay";
import { ExecutionResultsBadge } from "./ExecutionResultsBadge";
import { WorkflowExecutionResult } from "@/lib/expectations/types";

/**
 * Example component demonstrating ExecutionResultsDisplay and ExecutionResultsBadge
 *
 * This is a reference implementation showing how to use the execution results components.
 * Remove or adapt this file for your actual application.
 */
export function ExecutionResultsExample() {
  // Example: Successful execution
  const successResult: WorkflowExecutionResult = {
    success: true,
    success_criteria: {
      type: "all_actions_pass",
      description: "All actions must complete successfully",
    },
    checkpoint_results: [
      {
        checkpoint_name: "login_complete",
        passed: true,
        assertion_results: [
          {
            type: "text_present",
            pattern: "Welcome",
            passed: true,
            description: "Welcome message should be visible after login",
          },
          {
            type: "text_absent",
            pattern: "Error",
            passed: true,
            description: "No error messages should be present",
          },
        ],
        claude_review_results: [
          {
            instruction: "Verify that the user is logged in successfully",
            passed: true,
            observations: "User dashboard is displayed with correct username",
            confidence: 0.95,
          },
        ],
        screenshot_path: "/screenshots/login_complete_20250105_143022.png",
        duration_ms: 1234,
      },
      {
        checkpoint_name: "data_loaded",
        passed: true,
        assertion_results: [
          {
            type: "text_count",
            pattern: "Item \\d+",
            passed: true,
            description: "Should display 5 items",
            actual_value: 5,
            expected_value: 5,
          },
        ],
        duration_ms: 567,
      },
    ],
    actions_passed: 8,
    actions_failed: 0,
    total_duration_ms: 12345,
    exceeded_max_duration: false,
    states_visited: ["login_page", "dashboard", "data_view"],
  };

  // Example: Failed execution
  const failureResult: WorkflowExecutionResult = {
    success: false,
    success_criteria: {
      type: "checkpoint_passed",
      checkpoint_name: "payment_complete",
      description: "Payment checkpoint must pass",
    },
    checkpoint_results: [
      {
        checkpoint_name: "payment_complete",
        passed: false,
        assertion_results: [
          {
            type: "text_present",
            pattern: "Payment Successful",
            passed: false,
            description: "Payment success message should be displayed",
            error: "Pattern 'Payment Successful' not found in OCR output",
          },
        ],
        screenshot_path: "/screenshots/payment_complete_20250105_143045.png",
        duration_ms: 5000,
        error: "Checkpoint failed: Required text not found",
      },
    ],
    actions_passed: 5,
    actions_failed: 1,
    total_duration_ms: 8900,
    exceeded_max_duration: false,
    console_errors: ["TypeError: Cannot read property 'amount' of undefined"],
    states_visited: ["cart", "checkout", "payment"],
    error: "Workflow failed: Payment checkpoint did not pass",
  };

  // Example: Execution with timeout
  const timeoutResult: WorkflowExecutionResult = {
    success: false,
    success_criteria: {
      type: "all_actions_pass",
    },
    checkpoint_results: [],
    actions_passed: 3,
    actions_failed: 1,
    total_duration_ms: 65000,
    exceeded_max_duration: true,
    states_visited: ["start", "processing"],
    error: "Workflow execution exceeded maximum duration of 60000ms",
  };

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-bold mb-4">
          Execution Results Display Examples
        </h1>
        <p className="text-muted-foreground mb-6">
          This page demonstrates the ExecutionResultsDisplay and
          ExecutionResultsBadge components with different scenarios.
        </p>
      </div>

      {/* Badge Examples */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Badge Examples</h2>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Success (with icon)
            </div>
            <ExecutionResultsBadge result={successResult} showIcon={true} />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Success (with duration)
            </div>
            <ExecutionResultsBadge
              result={successResult}
              showDuration={true}
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Failure (with icon)
            </div>
            <ExecutionResultsBadge result={failureResult} showIcon={true} />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Timeout (with duration)
            </div>
            <ExecutionResultsBadge
              result={timeoutResult}
              showDuration={true}
            />
          </div>
        </div>
      </div>

      {/* Full Display Examples */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Full Display Examples</h2>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Successful Execution</h3>
          <ExecutionResultsDisplay result={successResult} />
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Failed Execution</h3>
          <ExecutionResultsDisplay result={failureResult} />
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Timeout Execution</h3>
          <ExecutionResultsDisplay result={timeoutResult} />
        </div>
      </div>
    </div>
  );
}
