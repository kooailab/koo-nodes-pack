class KoOWorkflowPresetManager:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "KoO Tools / Utility"
    DESCRIPTION = "Frontend utility node for capturing and restoring widget values from selected workflow nodes."
    SEARCH_ALIASES = ["koo workflow preset manager", "workflow preset manager", "preset manager"]

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "KoOWorkflowPresetManager": KoOWorkflowPresetManager,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOWorkflowPresetManager": "KoO Workflow Preset Manager",
}
