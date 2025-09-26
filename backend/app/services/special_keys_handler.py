"""Special keys handler for converting frontend special key placeholders to backend Key enum values."""

from enum import Enum


class SpecialKey(Enum):
    """Special keyboard keys mapping."""

    # Navigation keys
    ENTER = "\n"
    TAB = "\t"
    SPACE = " "
    BACKSPACE = "\b"
    DELETE = "delete"
    ESCAPE = "escape"

    # Arrow keys
    UP = "up"
    DOWN = "down"
    LEFT = "left"
    RIGHT = "right"

    # Modifier keys
    CTRL = "ctrl"
    ALT = "alt"
    SHIFT = "shift"
    META = "meta"  # Windows/Command key
    WIN = "win"
    CMD = "cmd"

    # Function keys
    F1 = "f1"
    F2 = "f2"
    F3 = "f3"
    F4 = "f4"
    F5 = "f5"
    F6 = "f6"
    F7 = "f7"
    F8 = "f8"
    F9 = "f9"
    F10 = "f10"
    F11 = "f11"
    F12 = "f12"

    # Navigation cluster
    HOME = "home"
    END = "end"
    PAGE_UP = "pageup"
    PAGE_DOWN = "pagedown"
    INSERT = "insert"


class SpecialKeysHandler:
    """Handler for processing special keys in text."""

    # Mapping of frontend placeholders to backend values
    KEY_MAPPINGS = {
        # Direct character mappings (already handled by frontend)
        "\n": "\n",  # Enter
        "\t": "\t",  # Tab
        " ": " ",  # Space
        "\b": "\b",  # Backspace
        # Placeholder mappings
        "{DELETE}": SpecialKey.DELETE.value,
        "{ESCAPE}": SpecialKey.ESCAPE.value,
        "{UP}": SpecialKey.UP.value,
        "{DOWN}": SpecialKey.DOWN.value,
        "{LEFT}": SpecialKey.LEFT.value,
        "{RIGHT}": SpecialKey.RIGHT.value,
        "{HOME}": SpecialKey.HOME.value,
        "{END}": SpecialKey.END.value,
        "{PAGE_UP}": SpecialKey.PAGE_UP.value,
        "{PAGE_DOWN}": SpecialKey.PAGE_DOWN.value,
        "{INSERT}": SpecialKey.INSERT.value,
        # Function keys
        "{F1}": SpecialKey.F1.value,
        "{F2}": SpecialKey.F2.value,
        "{F3}": SpecialKey.F3.value,
        "{F4}": SpecialKey.F4.value,
        "{F5}": SpecialKey.F5.value,
        "{F6}": SpecialKey.F6.value,
        "{F7}": SpecialKey.F7.value,
        "{F8}": SpecialKey.F8.value,
        "{F9}": SpecialKey.F9.value,
        "{F10}": SpecialKey.F10.value,
        "{F11}": SpecialKey.F11.value,
        "{F12}": SpecialKey.F12.value,
        # Modifiers (usually not typed alone, but included for completeness)
        "{CTRL}": SpecialKey.CTRL.value,
        "{ALT}": SpecialKey.ALT.value,
        "{SHIFT}": SpecialKey.SHIFT.value,
        "{META}": SpecialKey.META.value,
        "{WIN}": SpecialKey.WIN.value,
        "{CMD}": SpecialKey.CMD.value,
    }

    # Common key combinations
    COMBO_MAPPINGS = {
        "{CTRL+A}": [("key_down", "ctrl"), ("key_press", "a"), ("key_up", "ctrl")],
        "{CTRL+C}": [("key_down", "ctrl"), ("key_press", "c"), ("key_up", "ctrl")],
        "{CTRL+V}": [("key_down", "ctrl"), ("key_press", "v"), ("key_up", "ctrl")],
        "{CTRL+X}": [("key_down", "ctrl"), ("key_press", "x"), ("key_up", "ctrl")],
        "{CTRL+Z}": [("key_down", "ctrl"), ("key_press", "z"), ("key_up", "ctrl")],
        "{CTRL+S}": [("key_down", "ctrl"), ("key_press", "s"), ("key_up", "ctrl")],
        "{ALT+TAB}": [("key_down", "alt"), ("key_press", "tab"), ("key_up", "alt")],
        "{ALT+F4}": [("key_down", "alt"), ("key_press", "f4"), ("key_up", "alt")],
    }

    @classmethod
    def process_text(cls, text: str) -> list[tuple[str, str]]:
        """
        Process text containing special key placeholders.

        Returns a list of tuples (action_type, value) where:
        - action_type is either "type" for regular text or "key_press", "key_down", "key_up" for special keys
        - value is the text to type or key to press

        Args:
            text: Text containing special key placeholders

        Returns:
            List of (action_type, value) tuples
        """
        actions = []
        current_text = ""
        i = 0

        while i < len(text):
            # Check for combo placeholders first
            combo_found = False
            for combo_key, combo_actions in cls.COMBO_MAPPINGS.items():
                if text[i:].startswith(combo_key):
                    # Add any accumulated text first
                    if current_text:
                        actions.append(("type", current_text))
                        current_text = ""

                    # Add combo actions
                    actions.extend(combo_actions)
                    i += len(combo_key)
                    combo_found = True
                    break

            if combo_found:
                continue

            # Check for single key placeholders
            placeholder_found = False
            for placeholder, key_value in cls.KEY_MAPPINGS.items():
                if text[i:].startswith(placeholder):
                    # Add any accumulated text first
                    if current_text:
                        actions.append(("type", current_text))
                        current_text = ""

                    # Add key press action
                    actions.append(("key_press", key_value))
                    i += len(placeholder)
                    placeholder_found = True
                    break

            if not placeholder_found:
                # Regular character - accumulate
                current_text += text[i]
                i += 1

        # Add any remaining text
        if current_text:
            actions.append(("type", current_text))

        return actions

    @classmethod
    def convert_for_qontinui(cls, text: str) -> str:
        """
        Convert text with special key placeholders for use with Qontinui's Key enum.

        This method processes the text and returns a format that can be used
        directly with Qontinui's type_text action, replacing placeholders with
        actual key values.

        Args:
            text: Text containing special key placeholders

        Returns:
            Processed text ready for Qontinui
        """
        # For simple cases where we just want to replace placeholders with actual characters
        result = text

        # Replace simple character placeholders
        for placeholder, key_value in cls.KEY_MAPPINGS.items():
            if placeholder.startswith("{") and placeholder.endswith("}"):
                # For special keys that need to be handled separately,
                # we'll keep them as markers for the action handler
                if key_value in ["\n", "\t", " ", "\b"]:
                    # These can be typed directly
                    result = result.replace(placeholder, key_value)
                else:
                    # These need special handling - mark them
                    result = result.replace(placeholder, f"<KEY:{key_value}>")

        # Handle combos - these definitely need special handling
        for combo_key in cls.COMBO_MAPPINGS:
            result = result.replace(combo_key, f"<COMBO:{combo_key[1:-1]}>")

        return result


# Export the handler
special_keys_handler = SpecialKeysHandler()
