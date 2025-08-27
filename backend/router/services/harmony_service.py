"""
OpenAI Harmony Response Format Service

Implements the Harmony response format for improved gpt-oss 20B model responses.
Harmony provides structured conversation formatting with special tokens and channels
for better reasoning and response quality.

Documentation: https://cookbook.openai.com/articles/openai-harmony
GitHub: https://github.com/openai/harmony
"""

import logging
from typing import Dict, List, Optional, Any, AsyncGenerator
from openai_harmony import (
    load_harmony_encoding,
    HarmonyEncodingName,
    Role,
    Message,
    Conversation,
    ReasoningEffort,
    RenderConversationConfig,
)


class HarmonyService:
    """
    Service for handling OpenAI Harmony response format integration.
    
    Provides conversation preparation, response formatting, and message parsing
    specifically optimized for the gpt-oss 20B model.
    """

    def __init__(self):
        """Initialize Harmony encoding for gpt-oss model."""
        self.encoding = load_harmony_encoding(HarmonyEncodingName.HARMONY_GPT_OSS)

    def prepare_conversation(
        self,
        messages: List[Dict[str, str]],
        reasoning_effort: Optional[str] = "medium"
    ) -> List[int]:
        """
        Prepare conversation for model input using Harmony format.
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            reasoning_effort: Reasoning effort level ("low", "medium", "high")
            
        Returns:
            List of token IDs prepared for model completion
        """
        try:
            # Add mobile-optimized system prompt for conciseness
            mobile_system_prompt = (
                "You are an AI assistant optimized for mobile chat. "
                "Provide concise, direct answers. For simple questions, respond in 1-2 sentences. "
                "For complex questions, use brief bullet points instead of tables or long explanations. "
                "Prioritize clarity and brevity over comprehensive detail."
            )
            
            # Convert standard messages to Harmony Message objects
            harmony_messages = []
            
            # Add system prompt if no system message exists
            has_system_message = any(msg.get("role", "").lower() == "system" for msg in messages)
            if not has_system_message:
                system_message = Message.from_role_and_content(Role.SYSTEM, mobile_system_prompt)
                harmony_messages.append(system_message)
            
            for msg in messages:
                role_str = msg.get("role", "user").lower()
                content = msg.get("content", "")
                
                # Map standard roles to Harmony roles
                if role_str == "system":
                    role = Role.SYSTEM
                    # Enhance existing system prompt with mobile optimization
                    if mobile_system_prompt not in content:
                        content = f"{content}\n\n{mobile_system_prompt}"
                elif role_str == "user":
                    role = Role.USER
                elif role_str == "assistant":
                    role = Role.ASSISTANT
                elif role_str == "developer":
                    role = Role.DEVELOPER
                elif role_str == "tool":
                    role = Role.TOOL
                else:
                    role = Role.USER  # Default fallback
                
                harmony_message = Message.from_role_and_content(role, content)
                harmony_messages.append(harmony_message)
            
            # Create Harmony conversation
            conversation = Conversation.from_messages(harmony_messages)
            
            # Set up reasoning effort configuration
            effort_mapping = {
                "low": ReasoningEffort.LOW,
                "medium": ReasoningEffort.MEDIUM, 
                "high": ReasoningEffort.HIGH
            }
            effort = effort_mapping.get(reasoning_effort, ReasoningEffort.MEDIUM)
            
            # Render conversation for model completion with reasoning effort
            config = RenderConversationConfig(
                reasoning_effort=effort,
            )
            
            tokens = self.encoding.render_conversation_for_completion(
                conversation, 
                Role.ASSISTANT,
                config=config
            )
            
            
            return tokens
            
        except Exception as e:
            logging.error(f"Failed to prepare Harmony conversation: {e}")
            raise

    def parse_completion_response(
        self, 
        tokens: List[int],
        include_analysis: bool = True
    ) -> Dict[str, Any]:
        """
        Parse model completion tokens into structured Harmony messages.
        
        Args:
            tokens: Token IDs from model completion
            include_analysis: Whether to include analysis/reasoning channels
            
        Returns:
            Dict with parsed messages by channel (final, analysis, commentary)
        """
        try:
            # Parse tokens into Harmony messages
            messages = self.encoding.parse_messages_from_completion_tokens(tokens)
            
            # Organize messages by channel
            result = {
                "final": [],
                "analysis": [], 
                "commentary": [],
                "raw_messages": messages
            }
            
            for message in messages:
                content = message.get_text_content()
                role = message.role
                
                # Determine channel based on message properties
                # This is a simplified channel detection - in practice, Harmony
                # provides more sophisticated channel parsing
                if role == Role.ASSISTANT:
                    # Main response content goes to final channel
                    result["final"].append({
                        "role": "assistant",
                        "content": content,
                        "channel": "final"
                    })
                elif hasattr(message, 'channel') and message.channel == 'analysis':
                    if include_analysis:
                        result["analysis"].append({
                            "role": "assistant", 
                            "content": content,
                            "channel": "analysis"
                        })
                elif hasattr(message, 'channel') and message.channel == 'commentary':
                    result["commentary"].append({
                        "role": "assistant",
                        "content": content, 
                        "channel": "commentary"
                    })
                else:
                    # Default to final channel
                    result["final"].append({
                        "role": role.value if hasattr(role, 'value') else str(role),
                        "content": content,
                        "channel": "final"
                    })
            
            
            return result
            
        except Exception as e:
            logging.error(f"Failed to parse Harmony completion: {e}")
            raise

    def get_final_response_content(self, parsed_response: Dict[str, Any]) -> str:
        """
        Extract the final user-facing content from parsed Harmony response.
        
        Args:
            parsed_response: Output from parse_completion_response()
            
        Returns:
            Concatenated final response content
        """
        final_messages = parsed_response.get("final", [])
        contents = [msg.get("content", "") for msg in final_messages]
        return "".join(contents)

    def format_for_streaming(self, content: str, channel: str = "final") -> Dict[str, str]:
        """
        Format content for streaming with channel information.
        
        Args:
            content: Content to format
            channel: Channel type ("final", "analysis", "commentary")
            
        Returns:
            Formatted content with metadata
        """
        return {
            "content": content,
            "channel": channel,
            "format": "harmony"
        }

    def validate_harmony_encoding(self) -> bool:
        """
        Validate that Harmony encoding is working correctly.
        
        Returns:
            True if validation passes
        """
        try:
            # Test basic functionality
            test_messages = [Message.from_role_and_content(Role.USER, "Test")]
            test_conversation = Conversation.from_messages(test_messages)
            
            tokens = self.encoding.render_conversation_for_completion(
                test_conversation, Role.ASSISTANT
            )
            
            # Should get some tokens back
            return len(tokens) > 0
            
        except Exception as e:
            return False

    def get_encoding_info(self) -> Dict[str, Any]:
        """
        Get information about the current Harmony encoding.
        
        Returns:
            Dict with encoding details
        """
        return {
            "encoding_name": "HARMONY_GPT_OSS",
            "special_tokens": [
                "<|start|>", "<|end|>", "<|message|>", 
                "<|channel|>", "<|return|>"
            ],
            "supported_roles": ["system", "developer", "user", "assistant", "tool"],
            "supported_channels": ["final", "analysis", "commentary"],
            "reasoning_efforts": ["low", "medium", "high"]
        }