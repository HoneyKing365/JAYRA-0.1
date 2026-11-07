import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../shared/jsonFile";

const MAX_LESSONS = 500;

export interface Lesson {
  id: string;
  trigger: string;
  correction: string;
  sourceTaskId?: string;
  createdAt: string;
  updatedAt: string;
  uses: number;
}

interface LessonsFile {
  version: 1;
  lessons: Lesson[];
}

export interface AddLessonInput {
  trigger: string;
  correction: string;
  sourceTaskId?: string;
}

export class LessonStore {
  private lessons: Lesson[] = [];
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const stored = await readJsonFile<LessonsFile>(this.filePath, { version: 1, lessons: [] });
    this.lessons = stored && Array.isArray(stored.lessons)
      ? stored.lessons.filter(isLesson).slice(-MAX_LESSONS)
      : [];
    this.loaded = true;
  }

  async add(input: AddLessonInput): Promise<Lesson> {
    this.assertLoaded();
    const trigger = input.trigger.trim().slice(0, 1200);
    const correction = input.correction.trim().slice(0, 800);
    if (trigger.length < 4) throw new Error("A lesson needs a specific issue or task trigger.");
    if (correction.length < 4) throw new Error("A lesson needs a useful user correction.");

    const key = `${normalize(trigger)}|${normalize(correction)}`;
    const duplicate = this.lessons.find((lesson) =>
      `${normalize(lesson.trigger)}|${normalize(lesson.correction)}` === key,
    );
    const now = new Date().toISOString();
    if (duplicate) {
      duplicate.updatedAt = now;
      duplicate.sourceTaskId = input.sourceTaskId || duplicate.sourceTaskId;
      await this.persist();
      return structuredClone(duplicate);
    }

    const lesson: Lesson = {
      id: randomUUID(),
      trigger,
      correction,
      ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
      createdAt: now,
      updatedAt: now,
      uses: 0,
    };
    this.lessons.push(lesson);
    if (this.lessons.length > MAX_LESSONS) this.lessons.splice(0, this.lessons.length - MAX_LESSONS);
    await this.persist();
    return structuredClone(lesson);
  }

  async relevant(query: string, limit = 5): Promise<Lesson[]> {
    this.assertLoaded();
    const matches = this.match(query, limit);
    const ranked = matches
      .map((match) => this.lessons.find((lesson) => lesson.id === match.id))
      .filter((lesson): lesson is Lesson => Boolean(lesson));
    if (!ranked.length) return [];
    const accessedAt = new Date().toISOString();
    for (const lesson of ranked) {
      lesson.uses += 1;
      lesson.updatedAt = accessedAt;
    }
    await this.persist();
    return ranked.map((lesson) => structuredClone(lesson));
  }

  match(query: string, limit = 5): Lesson[] {
    this.assertLoaded();
    const queryWords = new Set(tokens(query));
    if (!queryWords.size) return [];
    return this.lessons
      .map((lesson) => {
        const lessonWords = new Set(tokens(`${lesson.trigger} ${lesson.correction}`));
        const overlap = [...queryWords].filter((word) => lessonWords.has(word)).length;
        const score = overlap / Math.max(1, Math.min(queryWords.size, lessonWords.size));
        return { lesson, overlap, score };
      })
      .filter(({ overlap, score }) => overlap >= Math.min(2, queryWords.size) && score >= 0.16)
      .sort((a, b) => b.score - a.score || b.lesson.updatedAt.localeCompare(a.lesson.updatedAt))
      .slice(0, Math.max(1, Math.min(10, Math.floor(limit))))
      .map(({ lesson }) => structuredClone(lesson));
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error("LessonStore.initialize() must be called first.");
  }

  private async persist(): Promise<void> {
    const snapshot: LessonsFile = { version: 1, lessons: structuredClone(this.lessons) };
    const next = this.writeQueue.catch(() => {}).then(() => writeJsonFile(this.filePath, snapshot));
    this.writeQueue = next;
    await next;
  }
}

function isLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const lesson = value as Partial<Lesson>;
  return typeof lesson.id === "string"
    && typeof lesson.trigger === "string"
    && typeof lesson.correction === "string"
    && typeof lesson.createdAt === "string"
    && typeof lesson.updatedAt === "string"
    && typeof lesson.uses === "number";
}

function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(" ").filter((word) => word.length > 2))];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
