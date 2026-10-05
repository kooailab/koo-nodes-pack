"""Backend contracts and backend-specific errors."""

from abc import ABC, abstractmethod
from contextlib import contextmanager


class PromptDirectorError(RuntimeError):
    """Base error suitable for presentation to a Prompt Director user."""


class BackendConfigurationError(PromptDirectorError):
    """The selected backend is absent or invalid."""


class BackendGenerationError(PromptDirectorError):
    """The selected backend failed while generating text."""


class BackendCapabilityError(PromptDirectorError):
    """The selected backend cannot handle the supplied request modality."""


class ImageEncodingError(PromptDirectorError):
    """A ComfyUI image could not be prepared safely for a vision backend."""


class PromptDirectorBackend(ABC):
    """Minimal backend interface; heavy implementations may import lazily."""

    name = "unknown"
    supports_text = True
    supports_vision = False

    def validate_vision_input(self, image):
        if image is not None and not self.supports_vision:
            raise BackendCapabilityError(
                f"Prompt Director backend '{self.name}' does not support vision; disconnect IMAGE or select a vision-capable backend."
            )

    def validate_instruction(self, instruction):
        self.validate_vision_input(instruction.image)
        self.validate_vision_input(instruction.image_2)

    @contextmanager
    def generation_session(self):
        """Yield a backend usable for a related sequence of generation calls."""
        yield self

    @abstractmethod
    def generate(self, instruction):
        """Return one generated prompt for an assembled PromptInstruction."""
        raise NotImplementedError
