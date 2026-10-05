class KoOOnOffManager:
    """
    Frontend utility node.

    The Python side only registers the node and its widgets so ComfyUI can load
    the extension. The actual on/off behavior is implemented in the
    matching frontend JavaScript file.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_node_ids": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
                # Change the default mode here if you want new nodes to start
                # in bypass mode instead of mute mode.
                "mode": (["mute", "bypass"], {"default": "mute"}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "utils/KoO"
    DESCRIPTION = "Frontend-only ON/OFF helper for muting or bypassing other nodes by ID."

    def noop(self, target_node_ids="", mode="mute"):
        return ()


NODE_CLASS_MAPPINGS = {
    "KoOOnOffManager": KoOOnOffManager,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOOnOffManager": "KoO On/Off Manager",
}
