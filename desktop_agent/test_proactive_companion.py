import dataclasses
import unittest

from desktop_agent.proactive_companion import ProactiveCompanionEngine, ScreenSnapshot


class ProactiveCompanionTests(unittest.TestCase):
    def test_quiet_level_disables_proactive_events(self):
        engine = ProactiveCompanionEngine()
        engine.update_settings(proactivity_level="quiet")
        snapshot = ScreenSnapshot(100.0, "Editor", "code.exe", "coding", 0.0)

        self.assertIsNone(engine._should_speak(1_000.0, snapshot))

    def test_proactive_event_contains_context_without_scripted_hints(self):
        engine = ProactiveCompanionEngine()
        snapshot = ScreenSnapshot(100.0, "Editor - project.ts", "code.exe", "coding", 0.0)
        engine._emit_proactive_event("active_task", snapshot)

        event = engine.pop_pending_events()[0]
        serialized = dataclasses.asdict(event)
        self.assertEqual(serialized["active_window"], snapshot.active_window)
        self.assertEqual(serialized["process_name"], snapshot.process_name)
        self.assertIn("context_history", serialized)
        self.assertNotIn("prompt_hints", serialized)


if __name__ == "__main__":
    unittest.main()
