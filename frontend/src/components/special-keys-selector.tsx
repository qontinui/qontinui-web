"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu"
import { Plus, Keyboard } from "lucide-react"
import { Badge } from "@/components/ui/badge"

// Define special keys based on qontinui Key enum
const SPECIAL_KEYS = {
  "Navigation": [
    { label: "Enter", value: "\n", display: "↵ Enter" },
    { label: "Tab", value: "\t", display: "⇥ Tab" },
    { label: "Space", value: " ", display: "␣ Space" },
    { label: "Backspace", value: "\b", display: "⌫ Backspace" },
    { label: "Delete", value: "{DELETE}", display: "⌦ Delete" },
    { label: "Escape", value: "{ESCAPE}", display: "⎋ Escape" },
  ],
  "Arrows": [
    { label: "Up", value: "{UP}", display: "↑ Up" },
    { label: "Down", value: "{DOWN}", display: "↓ Down" },
    { label: "Left", value: "{LEFT}", display: "← Left" },
    { label: "Right", value: "{RIGHT}", display: "→ Right" },
  ],
  "Modifiers": [
    { label: "Ctrl", value: "{CTRL}", display: "⌃ Ctrl" },
    { label: "Alt", value: "{ALT}", display: "⌥ Alt" },
    { label: "Shift", value: "{SHIFT}", display: "⇧ Shift" },
    { label: "Win/Cmd", value: "{META}", display: "⌘ Win/Cmd" },
  ],
  "Function": [
    { label: "F1", value: "{F1}", display: "F1" },
    { label: "F2", value: "{F2}", display: "F2" },
    { label: "F3", value: "{F3}", display: "F3" },
    { label: "F4", value: "{F4}", display: "F4" },
    { label: "F5", value: "{F5}", display: "F5" },
    { label: "F6", value: "{F6}", display: "F6" },
    { label: "F7", value: "{F7}", display: "F7" },
    { label: "F8", value: "{F8}", display: "F8" },
    { label: "F9", value: "{F9}", display: "F9" },
    { label: "F10", value: "{F10}", display: "F10" },
    { label: "F11", value: "{F11}", display: "F11" },
    { label: "F12", value: "{F12}", display: "F12" },
  ],
  "Navigation Cluster": [
    { label: "Home", value: "{HOME}", display: "⇱ Home" },
    { label: "End", value: "{END}", display: "⇲ End" },
    { label: "Page Up", value: "{PAGE_UP}", display: "⇞ Page Up" },
    { label: "Page Down", value: "{PAGE_DOWN}", display: "⇟ Page Down" },
    { label: "Insert", value: "{INSERT}", display: "Insert" },
  ],
  "Common Combos": [
    { label: "Ctrl+A", value: "{CTRL+A}", display: "⌃A Select All" },
    { label: "Ctrl+C", value: "{CTRL+C}", display: "⌃C Copy" },
    { label: "Ctrl+V", value: "{CTRL+V}", display: "⌃V Paste" },
    { label: "Ctrl+X", value: "{CTRL+X}", display: "⌃X Cut" },
    { label: "Ctrl+Z", value: "{CTRL+Z}", display: "⌃Z Undo" },
    { label: "Ctrl+S", value: "{CTRL+S}", display: "⌃S Save" },
    { label: "Alt+Tab", value: "{ALT+TAB}", display: "⌥⇥ Alt+Tab" },
    { label: "Alt+F4", value: "{ALT+F4}", display: "⌥F4 Close" },
  ],
}

interface SpecialKeysSelectorProps {
  onInsertKey: (key: string) => void
  textAreaRef?: React.RefObject<HTMLTextAreaElement>
}

export function SpecialKeysSelector({ onInsertKey, textAreaRef }: SpecialKeysSelectorProps) {
  const insertSpecialKey = (keyValue: string) => {
    if (textAreaRef?.current) {
      const textarea = textAreaRef.current
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const currentText = textarea.value

      // Insert the special key at the cursor position
      const newText = currentText.substring(0, start) + keyValue + currentText.substring(end)

      onInsertKey(newText)

      // Set cursor position after the inserted key
      setTimeout(() => {
        textarea.focus()
        const newPosition = start + keyValue.length
        textarea.setSelectionRange(newPosition, newPosition)
      }, 0)
    } else {
      // If no textarea ref, just append to the end
      onInsertKey(keyValue)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 border-gray-700 hover:bg-gray-800"
        >
          <Keyboard className="w-4 h-4 mr-1" />
          Special Keys
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 max-h-96 overflow-y-auto bg-[#27272A] border-gray-700" align="start">
        <DropdownMenuLabel className="text-sm font-medium text-gray-300">
          Insert Special Keys
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-700" />

        {Object.entries(SPECIAL_KEYS).map(([category, keys]) => (
          <div key={category}>
            <DropdownMenuLabel className="text-xs font-medium text-gray-400 mt-2">
              {category}
            </DropdownMenuLabel>
            {keys.map((key) => (
              <DropdownMenuItem
                key={key.value}
                className="text-xs hover:bg-gray-800 cursor-pointer"
                onClick={() => insertSpecialKey(key.value)}
              >
                <span className="font-mono">{key.display}</span>
              </DropdownMenuItem>
            ))}
            {category !== "Common Combos" && <DropdownMenuSeparator className="bg-gray-700" />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Helper component to display special keys in the text
export function SpecialKeyDisplay({ text }: { text: string }) {
  // Map special key placeholders to their display symbols
  const keySymbols: { [key: string]: string } = {
    "ENTER": "↵",
    "TAB": "⇥",
    "SPACE": "␣",
    "BACKSPACE": "⌫",
    "DELETE": "⌦",
    "ESCAPE": "⎋",
    "UP": "↑",
    "DOWN": "↓",
    "LEFT": "←",
    "RIGHT": "→",
    "HOME": "⇱",
    "END": "⇲",
    "PAGE_UP": "⇞",
    "PAGE_DOWN": "⇟",
    "INSERT": "INS",
    "CTRL": "⌃",
    "ALT": "⌥",
    "SHIFT": "⇧",
    "META": "⌘",
    "WIN": "⊞",
    "CMD": "⌘",
    "CTRL+A": "⌃A",
    "CTRL+C": "⌃C",
    "CTRL+V": "⌃V",
    "CTRL+X": "⌃X",
    "CTRL+Z": "⌃Z",
    "CTRL+S": "⌃S",
    "ALT+TAB": "⌥⇥",
    "ALT+F4": "⌥F4",
  }

  // Parse the text and highlight special keys
  const parts: React.ReactNode[] = []
  let currentPart = ""
  let i = 0

  while (i < text.length) {
    if (text[i] === "{" && text.indexOf("}", i) > i) {
      // Found a special key placeholder
      if (currentPart) {
        parts.push(<span key={parts.length}>{currentPart}</span>)
        currentPart = ""
      }

      const endIndex = text.indexOf("}", i)
      const keyPlaceholder = text.substring(i, endIndex + 1)
      const keyName = keyPlaceholder.substring(1, keyPlaceholder.length - 1)
      const displaySymbol = keySymbols[keyName] || keyName

      parts.push(
        <Badge
          key={parts.length}
          variant="secondary"
          className="mx-0.5 px-1 py-0 text-[10px] bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30"
          title={keyName} // Show full name on hover
        >
          {displaySymbol}
        </Badge>
      )
      i = endIndex + 1
    } else if (text[i] === "\n") {
      // Special handling for actual newline character
      if (currentPart) {
        parts.push(<span key={parts.length}>{currentPart}</span>)
        currentPart = ""
      }
      parts.push(
        <Badge
          key={parts.length}
          variant="secondary"
          className="mx-0.5 px-1 py-0 text-[10px] bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30"
          title="Enter"
        >
          ↵
        </Badge>
      )
      i++
    } else if (text[i] === "\t") {
      // Special handling for actual tab character
      if (currentPart) {
        parts.push(<span key={parts.length}>{currentPart}</span>)
        currentPart = ""
      }
      parts.push(
        <Badge
          key={parts.length}
          variant="secondary"
          className="mx-0.5 px-1 py-0 text-[10px] bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30"
          title="Tab"
        >
          ⇥
        </Badge>
      )
      i++
    } else {
      currentPart += text[i]
      i++
    }
  }

  if (currentPart) {
    parts.push(<span key={parts.length}>{currentPart}</span>)
  }

  return <>{parts}</>
}
