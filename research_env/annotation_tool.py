#!/usr/bin/env python3
"""
GUI Annotation Tool for Ground Truth Creation - OPTIMIZED

Features:
- Load multiple screenshots
- Draw and resize bounding boxes
- Fast zoom and pan (right-click to pan)
- Add labels and descriptions for each element
- Save annotations in JSON format

Performance optimizations:
- Event-driven updates (no polling)
- Efficient redraw only when needed
- Cached image scaling
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk, ImageDraw
import json
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import os


class BoundingBox:
    """Represents a bounding box annotation"""

    def __init__(self, x1: int, y1: int, x2: int, y2: int, label: str = "", description: str = "", reason: str = ""):
        self.x1 = min(x1, x2)
        self.y1 = min(y1, y2)
        self.x2 = max(x1, x2)
        self.y2 = max(y1, y2)
        self.label = label
        self.description = description
        self.reason = reason

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'bbox': [self.x1, self.y1, self.x2, self.y2],
            'label': self.label,
            'description': self.description,
            'reason': self.reason,
            'width': self.x2 - self.x1,
            'height': self.y2 - self.y1,
            'area': (self.x2 - self.x1) * (self.y2 - self.y1)
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'BoundingBox':
        """Create from dictionary"""
        bbox = data['bbox']
        return cls(
            bbox[0], bbox[1], bbox[2], bbox[3],
            data.get('label', ''),
            data.get('description', ''),
            data.get('reason', '')
        )

    def contains_point(self, x: int, y: int, margin: int = 5) -> str:
        """Check if point is on edge or inside box. Returns: 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'inside', or ''"""
        on_left = abs(x - self.x1) <= margin
        on_right = abs(x - self.x2) <= margin
        on_top = abs(y - self.y1) <= margin
        on_bottom = abs(y - self.y2) <= margin

        inside_x = self.x1 <= x <= self.x2
        inside_y = self.y1 <= y <= self.y2

        # Check corners first
        if on_top and on_left and inside_x and inside_y:
            return 'nw'
        if on_top and on_right and inside_x and inside_y:
            return 'ne'
        if on_bottom and on_left and inside_x and inside_y:
            return 'sw'
        if on_bottom and on_right and inside_x and inside_y:
            return 'se'

        # Check edges
        if on_top and inside_x:
            return 'n'
        if on_bottom and inside_x:
            return 's'
        if on_left and inside_y:
            return 'w'
        if on_right and inside_y:
            return 'e'

        # Check inside
        if inside_x and inside_y:
            return 'inside'

        return ''

    def resize(self, edge: str, dx: int, dy: int):
        """Resize the bounding box by dragging an edge"""
        if 'n' in edge:
            self.y1 += dy
        if 's' in edge:
            self.y2 += dy
        if 'w' in edge:
            self.x1 += dx
        if 'e' in edge:
            self.x2 += dx

        # Ensure min size and correct order
        if self.x2 < self.x1:
            self.x1, self.x2 = self.x2, self.x1
        if self.y2 < self.y1:
            self.y1, self.y2 = self.y2, self.y1

        # Minimum size
        if self.x2 - self.x1 < 5:
            self.x2 = self.x1 + 5
        if self.y2 - self.y1 < 5:
            self.y2 = self.y1 + 5

    def move(self, dx: int, dy: int):
        """Move the entire bounding box"""
        self.x1 += dx
        self.x2 += dx
        self.y1 += dy
        self.y2 += dy


class AnnotationCanvas(tk.Canvas):
    """Canvas for drawing and editing bounding boxes - OPTIMIZED"""

    CURSORS = {
        'n': 'top_side',
        's': 'bottom_side',
        'e': 'right_side',
        'w': 'left_side',
        'ne': 'top_right_corner',
        'nw': 'top_left_corner',
        'se': 'bottom_right_corner',
        'sw': 'bottom_left_corner',
        'inside': 'fleur',
        '': 'arrow'
    }

    def __init__(self, parent, on_change_callback=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.image = None
        self.photo_image = None
        self.scaled_cache = {}  # Cache scaled images
        self.boxes: List[BoundingBox] = []
        self.selected_box: Optional[BoundingBox] = None
        self.current_edge: str = ''
        self.on_change_callback = on_change_callback

        # Drawing state
        self.drawing = False
        self.draw_start_x = 0
        self.draw_start_y = 0
        self.temp_box = None

        # Pan and zoom
        self.zoom_level = 1.0
        self.pan_x = 0
        self.pan_y = 0
        self.panning = False
        self.pan_start_x = 0
        self.pan_start_y = 0

        # Last mouse position for dragging
        self.last_x = 0
        self.last_y = 0

        # Bind events
        self.bind('<Button-1>', self.on_mouse_down)
        self.bind('<B1-Motion>', self.on_mouse_drag)
        self.bind('<ButtonRelease-1>', self.on_mouse_up)
        self.bind('<Motion>', self.on_mouse_move)

        # Right-click for panning (more intuitive)
        self.bind('<Button-3>', self.on_pan_start)  # Right mouse
        self.bind('<B3-Motion>', self.on_pan_drag)
        self.bind('<ButtonRelease-3>', self.on_pan_end)

        # Middle mouse as alternative
        self.bind('<Button-2>', self.on_pan_start)
        self.bind('<B2-Motion>', self.on_pan_drag)
        self.bind('<ButtonRelease-2>', self.on_pan_end)

        self.bind('<MouseWheel>', self.on_zoom)  # Windows/Mac
        self.bind('<Button-4>', lambda e: self.on_zoom_linux(e, 1))  # Linux scroll up
        self.bind('<Button-5>', lambda e: self.on_zoom_linux(e, -1))  # Linux scroll down

    def load_image(self, image_path: str):
        """Load an image onto the canvas"""
        self.image = Image.open(image_path)
        self.zoom_level = 1.0
        self.pan_x = 0
        self.pan_y = 0
        self.boxes.clear()
        self.selected_box = None
        self.scaled_cache.clear()  # Clear cache
        self.redraw()

    def screen_to_image_coords(self, screen_x: int, screen_y: int) -> Tuple[int, int]:
        """Convert screen coordinates to image coordinates"""
        img_x = int((screen_x - self.pan_x) / self.zoom_level)
        img_y = int((screen_y - self.pan_y) / self.zoom_level)
        return img_x, img_y

    def image_to_screen_coords(self, img_x: int, img_y: int) -> Tuple[int, int]:
        """Convert image coordinates to screen coordinates"""
        screen_x = int(img_x * self.zoom_level + self.pan_x)
        screen_y = int(img_y * self.zoom_level + self.pan_y)
        return screen_x, screen_y

    def on_zoom(self, event):
        """Handle zoom with mouse wheel - OPTIMIZED"""
        if not self.image:
            return

        # Get zoom factor (increased sensitivity)
        if event.delta > 0:
            factor = 1.2  # Increased from 1.1
        else:
            factor = 0.833  # 1/1.2

        # Zoom towards mouse position
        old_zoom = self.zoom_level
        self.zoom_level *= factor
        self.zoom_level = max(0.1, min(50.0, self.zoom_level))  # Increased max from 10 to 50

        # Adjust pan to zoom towards mouse
        zoom_ratio = self.zoom_level / old_zoom
        self.pan_x = event.x - (event.x - self.pan_x) * zoom_ratio
        self.pan_y = event.y - (event.y - self.pan_y) * zoom_ratio

        self.redraw()

    def on_zoom_linux(self, event, direction):
        """Handle zoom on Linux"""
        event.delta = direction * 120
        self.on_zoom(event)

    def on_pan_start(self, event):
        """Start panning"""
        self.panning = True
        self.pan_start_x = event.x
        self.pan_start_y = event.y
        self.config(cursor='hand2')

    def on_pan_drag(self, event):
        """Pan the view - OPTIMIZED"""
        if self.panning:
            dx = event.x - self.pan_start_x
            dy = event.y - self.pan_start_y
            self.pan_x += dx
            self.pan_y += dy
            self.pan_start_x = event.x
            self.pan_start_y = event.y
            self.redraw()

    def on_pan_end(self, event):
        """End panning"""
        self.panning = False
        self.config(cursor='crosshair')

    def on_mouse_down(self, event):
        """Handle mouse button press"""
        if not self.image or self.panning:
            return

        img_x, img_y = self.screen_to_image_coords(event.x, event.y)

        # Check if clicking on existing box
        for box in reversed(self.boxes):  # Check from top
            edge = box.contains_point(img_x, img_y)
            if edge:
                self.selected_box = box
                self.current_edge = edge
                self.last_x = img_x
                self.last_y = img_y
                self.redraw()
                self._notify_change()
                return

        # Start drawing new box
        self.drawing = True
        self.draw_start_x = img_x
        self.draw_start_y = img_y
        self.temp_box = None
        self.selected_box = None
        self.redraw()
        self._notify_change()

    def on_mouse_drag(self, event):
        """Handle mouse drag - OPTIMIZED"""
        if not self.image or self.panning:
            return

        img_x, img_y = self.screen_to_image_coords(event.x, event.y)

        # Clamp to image bounds
        img_x = max(0, min(self.image.width, img_x))
        img_y = max(0, min(self.image.height, img_y))

        if self.drawing:
            # Update temp box while drawing
            self.temp_box = BoundingBox(self.draw_start_x, self.draw_start_y, img_x, img_y)
            self.redraw()
        elif self.selected_box and self.current_edge:
            # Resize or move existing box
            dx = img_x - self.last_x
            dy = img_y - self.last_y

            if self.current_edge == 'inside':
                self.selected_box.move(dx, dy)
            else:
                self.selected_box.resize(self.current_edge, dx, dy)

            self.last_x = img_x
            self.last_y = img_y
            self.redraw()

    def on_mouse_up(self, event):
        """Handle mouse button release"""
        if self.drawing and self.temp_box:
            # Finalize new box if it's large enough
            if self.temp_box.x2 - self.temp_box.x1 > 5 and self.temp_box.y2 - self.temp_box.y1 > 5:
                self.boxes.append(self.temp_box)
                self.selected_box = self.temp_box
                self._notify_change()
            self.temp_box = None
            self.drawing = False
            self.redraw()

        self.current_edge = ''

    def on_mouse_move(self, event):
        """Update cursor based on position"""
        if not self.image or self.drawing or self.panning or (self.selected_box and self.current_edge):
            return

        img_x, img_y = self.screen_to_image_coords(event.x, event.y)

        for box in reversed(self.boxes):
            edge = box.contains_point(img_x, img_y)
            if edge:
                self.config(cursor=self.CURSORS.get(edge, 'arrow'))
                return

        self.config(cursor='crosshair')

    def redraw(self):
        """Redraw the canvas - OPTIMIZED with caching"""
        self.delete('all')

        if not self.image:
            return

        # Calculate scaled dimensions
        scaled_width = int(self.image.width * self.zoom_level)
        scaled_height = int(self.image.height * self.zoom_level)

        if scaled_width > 0 and scaled_height > 0:
            # Use cache key
            cache_key = (scaled_width, scaled_height)

            # Check cache
            if cache_key not in self.scaled_cache:
                # Only rescale if not cached
                scaled_image = self.image.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
                self.scaled_cache[cache_key] = ImageTk.PhotoImage(scaled_image)

                # Limit cache size
                if len(self.scaled_cache) > 10:
                    # Remove oldest entry
                    self.scaled_cache.pop(next(iter(self.scaled_cache)))

            self.photo_image = self.scaled_cache[cache_key]
            self.create_image(self.pan_x, self.pan_y, anchor='nw', image=self.photo_image)

        # Draw bounding boxes
        for box in self.boxes:
            self._draw_box(box, color='yellow' if box == self.selected_box else 'lime', width=2)

        # Draw temp box
        if self.temp_box:
            self._draw_box(self.temp_box, color='cyan', width=1, dash=(5, 5))

    def _draw_box(self, box: BoundingBox, color: str, width: int, dash=None):
        """Draw a bounding box on the canvas"""
        x1, y1 = self.image_to_screen_coords(box.x1, box.y1)
        x2, y2 = self.image_to_screen_coords(box.x2, box.y2)

        kwargs = {'outline': color, 'width': width}
        if dash:
            kwargs['dash'] = dash

        self.create_rectangle(x1, y1, x2, y2, **kwargs)

        # Draw label if exists
        if box.label:
            self.create_text(x1, y1 - 5, text=box.label, anchor='sw', fill=color, font=('Arial', 10, 'bold'))

    def delete_selected(self):
        """Delete the selected box"""
        if self.selected_box and self.selected_box in self.boxes:
            self.boxes.remove(self.selected_box)
            self.selected_box = None
            self.redraw()
            self._notify_change()
            return True
        return False

    def _notify_change(self):
        """Notify parent of changes"""
        if self.on_change_callback:
            self.on_change_callback()


class AnnotationTool:
    """Main annotation tool application - OPTIMIZED"""

    def __init__(self, root):
        self.root = root
        self.root.title("GUI Element Annotation Tool - OPTIMIZED")
        self.root.geometry("1400x900")

        self.screenshots_dir = Path("screenshots")
        self.annotations_dir = Path("annotations")
        self.screenshots_dir.mkdir(exist_ok=True)
        self.annotations_dir.mkdir(exist_ok=True)

        self.screenshot_files: List[Path] = []
        self.current_screenshot_idx = 0
        self.current_screenshot_path: Optional[Path] = None

        self._create_ui()

    def _create_ui(self):
        """Create the user interface"""

        # Main container
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill='both', expand=True, padx=5, pady=5)

        # Left panel - Canvas
        left_frame = ttk.Frame(main_frame)
        left_frame.pack(side='left', fill='both', expand=True)

        # Toolbar
        toolbar = ttk.Frame(left_frame)
        toolbar.pack(fill='x', pady=5)

        ttk.Button(toolbar, text="Load Screenshots", command=self.load_screenshots).pack(side='left', padx=2)
        ttk.Button(toolbar, text="Save Annotations", command=self.save_annotations).pack(side='left', padx=2)
        ttk.Button(toolbar, text="Load Annotations", command=self.load_annotations).pack(side='left', padx=2)
        ttk.Button(toolbar, text="Delete Selected (Del)", command=self.delete_selected).pack(side='left', padx=2)
        ttk.Button(toolbar, text="Reset Zoom", command=self.reset_zoom).pack(side='left', padx=2)

        # Screenshot selector
        screenshot_frame = ttk.Frame(left_frame)
        screenshot_frame.pack(fill='x', pady=5)

        ttk.Label(screenshot_frame, text="Screenshot to annotate:").pack(side='left', padx=5)
        self.screenshot_var = tk.StringVar()
        self.screenshot_combo = ttk.Combobox(screenshot_frame, textvariable=self.screenshot_var, state='readonly', width=50)
        self.screenshot_combo.pack(side='left', padx=5, fill='x', expand=True)
        self.screenshot_combo.bind('<<ComboboxSelected>>', self.on_screenshot_selected)

        # Canvas
        canvas_frame = ttk.Frame(left_frame, relief='sunken', borderwidth=2)
        canvas_frame.pack(fill='both', expand=True)

        self.canvas = AnnotationCanvas(canvas_frame, on_change_callback=self.on_canvas_change,
                                      bg='gray30', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)

        # Info label
        self.info_label = ttk.Label(left_frame,
                                    text="Mouse wheel: zoom | Right-click drag: pan | Left-click: draw/edit boxes",
                                    foreground='blue')
        self.info_label.pack(fill='x', pady=2)

        # Right panel - Box details
        right_frame = ttk.Frame(main_frame, width=300)
        right_frame.pack(side='right', fill='both', padx=(5, 0))
        right_frame.pack_propagate(False)

        ttk.Label(right_frame, text="Element Details", font=('Arial', 12, 'bold')).pack(pady=5)

        # Box list
        list_frame = ttk.LabelFrame(right_frame, text="Annotated Elements")
        list_frame.pack(fill='both', expand=True, pady=5)

        self.box_listbox = tk.Listbox(list_frame, height=10)
        self.box_listbox.pack(fill='both', expand=True, padx=5, pady=5)
        self.box_listbox.bind('<<ListboxSelect>>', self.on_box_selected)

        # Details form
        details_frame = ttk.LabelFrame(right_frame, text="Selected Element")
        details_frame.pack(fill='x', pady=5)

        ttk.Label(details_frame, text="Label:").pack(anchor='w', padx=5, pady=(5, 0))
        self.label_entry = ttk.Entry(details_frame)
        self.label_entry.pack(fill='x', padx=5, pady=(0, 5))

        ttk.Label(details_frame, text="Description:").pack(anchor='w', padx=5)
        self.desc_text = tk.Text(details_frame, height=3, wrap='word')
        self.desc_text.pack(fill='x', padx=5, pady=(0, 5))

        ttk.Label(details_frame, text="Why is this useful?").pack(anchor='w', padx=5)
        self.reason_text = tk.Text(details_frame, height=3, wrap='word')
        self.reason_text.pack(fill='x', padx=5, pady=(0, 5))

        ttk.Button(details_frame, text="Update Element", command=self.update_selected_box).pack(pady=5)

        # Statistics
        stats_frame = ttk.LabelFrame(right_frame, text="Statistics")
        stats_frame.pack(fill='x', pady=5)

        self.stats_label = ttk.Label(stats_frame, text="No annotations yet", justify='left')
        self.stats_label.pack(padx=5, pady=5, anchor='w')

        # Keyboard shortcuts
        self.root.bind('<Delete>', lambda e: self.delete_selected())
        self.root.bind('<Control-s>', lambda e: self.save_annotations())

    def on_canvas_change(self):
        """Called when canvas changes - updates UI"""
        self.update_box_list()
        self.update_stats()

    def load_screenshots(self):
        """Load multiple screenshots"""
        files = filedialog.askopenfilenames(
            title="Select Screenshots",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif"), ("All files", "*.*")]
        )

        if files:
            # Copy to screenshots directory and track
            self.screenshot_files = []
            for f in files:
                src = Path(f)
                dst = self.screenshots_dir / src.name

                # Copy if not already there
                if not dst.exists():
                    import shutil
                    shutil.copy(src, dst)

                self.screenshot_files.append(dst)

            # Update combo box
            self.screenshot_combo['values'] = [f.name for f in self.screenshot_files]
            if self.screenshot_files:
                self.screenshot_combo.current(0)
                self.on_screenshot_selected(None)

            messagebox.showinfo("Success", f"Loaded {len(self.screenshot_files)} screenshots")

    def on_screenshot_selected(self, event):
        """Handle screenshot selection"""
        idx = self.screenshot_combo.current()
        if 0 <= idx < len(self.screenshot_files):
            self.current_screenshot_idx = idx
            self.current_screenshot_path = self.screenshot_files[idx]
            self.canvas.load_image(str(self.current_screenshot_path))

            # Try to load existing annotations
            self.try_load_current_annotations()

    def try_load_current_annotations(self):
        """Try to load annotations for current screenshot"""
        if not self.current_screenshot_path:
            return

        annotation_file = self.annotations_dir / f"{self.current_screenshot_path.stem}_annotations.json"
        if annotation_file.exists():
            try:
                with open(annotation_file, 'r') as f:
                    data = json.load(f)
                    self.canvas.boxes = [BoundingBox.from_dict(b) for b in data['annotations']]
                    self.canvas.redraw()
                    self.update_box_list()
                    self.update_stats()
            except Exception as e:
                print(f"Error loading annotations: {e}")

    def save_annotations(self):
        """Save annotations for current screenshot"""
        if not self.current_screenshot_path or not self.canvas.boxes:
            messagebox.showwarning("Warning", "No annotations to save")
            return

        annotation_file = self.annotations_dir / f"{self.current_screenshot_path.stem}_annotations.json"

        data = {
            'screenshot': self.current_screenshot_path.name,
            'image_size': [self.canvas.image.width, self.canvas.image.height],
            'num_elements': len(self.canvas.boxes),
            'annotations': [box.to_dict() for box in self.canvas.boxes]
        }

        with open(annotation_file, 'w') as f:
            json.dump(data, f, indent=2)

        messagebox.showinfo("Success", f"Saved {len(self.canvas.boxes)} annotations to {annotation_file.name}")

    def load_annotations(self):
        """Load annotations from file"""
        file_path = filedialog.askopenfilename(
            title="Load Annotations",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialdir=self.annotations_dir
        )

        if file_path:
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    self.canvas.boxes = [BoundingBox.from_dict(b) for b in data['annotations']]
                    self.canvas.redraw()
                    self.update_box_list()
                    self.update_stats()
                messagebox.showinfo("Success", f"Loaded {len(self.canvas.boxes)} annotations")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to load annotations: {e}")

    def delete_selected(self):
        """Delete selected box"""
        self.canvas.delete_selected()

    def reset_zoom(self):
        """Reset zoom and pan"""
        self.canvas.zoom_level = 1.0
        self.canvas.pan_x = 0
        self.canvas.pan_y = 0
        self.canvas.redraw()

    def update_box_list(self):
        """Update the list of boxes"""
        current_selection = self.box_listbox.curselection()
        self.box_listbox.delete(0, tk.END)

        for i, box in enumerate(self.canvas.boxes):
            label = box.label if box.label else f"Element {i+1}"
            self.box_listbox.insert(tk.END, label)

        # Restore selection
        if current_selection:
            self.box_listbox.selection_set(current_selection)

    def on_box_selected(self, event):
        """Handle box selection from list"""
        selection = self.box_listbox.curselection()
        if selection:
            idx = selection[0]
            if 0 <= idx < len(self.canvas.boxes):
                box = self.canvas.boxes[idx]
                self.canvas.selected_box = box
                self.canvas.redraw()

                # Update form
                self.label_entry.delete(0, tk.END)
                self.label_entry.insert(0, box.label)

                self.desc_text.delete('1.0', tk.END)
                self.desc_text.insert('1.0', box.description)

                self.reason_text.delete('1.0', tk.END)
                self.reason_text.insert('1.0', box.reason)

    def update_selected_box(self):
        """Update selected box with form data"""
        if self.canvas.selected_box:
            self.canvas.selected_box.label = self.label_entry.get()
            self.canvas.selected_box.description = self.desc_text.get('1.0', tk.END).strip()
            self.canvas.selected_box.reason = self.reason_text.get('1.0', tk.END).strip()
            self.canvas.redraw()
            self.update_box_list()

    def update_stats(self):
        """Update statistics display"""
        if not self.canvas.boxes:
            self.stats_label.config(text="No annotations yet")
            return

        num_boxes = len(self.canvas.boxes)
        num_labeled = sum(1 for b in self.canvas.boxes if b.label)
        num_described = sum(1 for b in self.canvas.boxes if b.description)
        num_reasoned = sum(1 for b in self.canvas.boxes if b.reason)

        avg_area = sum((b.x2 - b.x1) * (b.y2 - b.y1) for b in self.canvas.boxes) / num_boxes

        stats_text = f"""Total elements: {num_boxes}
Labeled: {num_labeled}
Described: {num_described}
Reason given: {num_reasoned}
Avg area: {avg_area:.0f} px²"""

        self.stats_label.config(text=stats_text)


def main():
    root = tk.Tk()
    app = AnnotationTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
