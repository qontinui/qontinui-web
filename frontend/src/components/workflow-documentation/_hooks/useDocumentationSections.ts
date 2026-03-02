import { useState, useEffect, useMemo, useCallback } from "react";
import { Section, ViewerTOCItem } from "../types";

function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  lines.forEach((line) => {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }

      const level = headerMatch[1]?.length ?? 1;
      const text = headerMatch[2]?.trim() ?? "";
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");

      currentSection = { id, title: text, content: "", level };
    } else if (currentSection) {
      currentSection.content += line + "\n";
    }
  });

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

function buildTOC(sections: Section[]): ViewerTOCItem[] {
  const toc: ViewerTOCItem[] = [];
  const stack: ViewerTOCItem[] = [];

  sections.forEach((section) => {
    const item: ViewerTOCItem = {
      level: section.level,
      text: section.title,
      id: section.id,
      children: [],
    };

    while (
      stack.length > 0 &&
      (stack[stack.length - 1]?.level ?? 0) >= item.level
    ) {
      stack.pop();
    }

    if (stack.length === 0) {
      toc.push(item);
    } else {
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(item);
      }
    }

    stack.push(item);
  });

  return toc;
}

export function useDocumentationSections(content: string) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set()
  );

  const sections = useMemo(() => parseSections(content), [content]);
  const toc = useMemo(() => buildTOC(sections), [sections]);

  const filteredSections = useMemo(
    () =>
      searchQuery
        ? sections.filter(
            (section) =>
              section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              section.content.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : sections,
    [sections, searchQuery]
  );

  const scrollToSection = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(id);
    }
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [sections]);

  return {
    sections,
    toc,
    filteredSections,
    searchQuery,
    setSearchQuery,
    activeSection,
    collapsedSections,
    scrollToSection,
    toggleSection,
  };
}
