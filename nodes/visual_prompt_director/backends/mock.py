"""Dependency-free backend for assembly and UI smoke testing."""

from .base import PromptDirectorBackend


class MockBackend(PromptDirectorBackend):
    name = "mock"

    def generate(self, instruction):
        idea = instruction.user_message.strip()
        return f"[Mock Prompt Director] {idea}"
