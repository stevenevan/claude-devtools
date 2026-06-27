package analysis

import (
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/ptr"
)

// chunkBuildState buffers AI messages and flushes them into one AI chunk on the
// next non-AI message (state_machine.rs).
type chunkBuildState struct {
	aiBuffer      []domain.ParsedMessage
	progressCount uint32
	progressTexts []string
}

func (s *chunkBuildState) pushAI(m domain.ParsedMessage) {
	s.aiBuffer = append(s.aiBuffer, m)
}

func (s *chunkBuildState) trackProgress(m domain.ParsedMessage) {
	if m.MessageType != "progress" {
		return
	}
	s.progressCount++
	if m.Content.Text != nil && *m.Content.Text != "" {
		s.progressTexts = append(s.progressTexts, *m.Content.Text)
	}
}

func (s *chunkBuildState) flushAIChunk(subagents []domain.Process, all []domain.ParsedMessage) (domain.EnhancedChunk, bool) {
	if len(s.aiBuffer) == 0 {
		return domain.EnhancedChunk{}, false
	}
	var pc *uint32
	if s.progressCount > 0 {
		pc = ptr.To(s.progressCount)
	}
	var pt *[]string
	if len(s.progressTexts) > 0 {
		texts := s.progressTexts
		pt = &texts
	}
	chunk := buildAIChunkFromBuffer(s.aiBuffer, subagents, all, pc, pt)
	s.aiBuffer = nil
	s.progressCount = 0
	s.progressTexts = nil
	return chunk, true
}

// BuildChunks mirrors chunk_builder::build_chunks: classify main-thread messages
// and drive the AI-buffer state machine.
func BuildChunks(messages []domain.ParsedMessage, subagents []domain.Process) []domain.EnhancedChunk {
	chunks := []domain.EnhancedChunk{}
	state := &chunkBuildState{}

	for i := range messages {
		if messages[i].IsSidechain {
			continue
		}
		msg := messages[i]
		switch parsing.Categorize(&msg) {
		case domain.CategoryHardNoise:
			state.trackProgress(msg)
		case domain.CategoryCompact:
			chunks = appendFlush(chunks, state, subagents, messages)
			chunks = append(chunks, buildCompactChunk(&msg))
		case domain.CategoryUser:
			chunks = appendFlush(chunks, state, subagents, messages)
			chunks = append(chunks, buildUserChunk(&msg))
		case domain.CategorySystem:
			chunks = appendFlush(chunks, state, subagents, messages)
			chunks = append(chunks, buildSystemChunk(&msg))
		case domain.CategoryEvent:
			chunks = appendFlush(chunks, state, subagents, messages)
			chunks = append(chunks, buildEventChunk(&msg))
		case domain.CategoryAi:
			state.pushAI(msg)
		}
	}
	if ai, ok := state.flushAIChunk(subagents, messages); ok {
		chunks = append(chunks, ai)
	}
	return chunks
}

func appendFlush(chunks []domain.EnhancedChunk, state *chunkBuildState, subagents []domain.Process, all []domain.ParsedMessage) []domain.EnhancedChunk {
	if ai, ok := state.flushAIChunk(subagents, all); ok {
		return append(chunks, ai)
	}
	return chunks
}

// BuildSessionDetail mirrors chunk_builder::build_session_detail.
func BuildSessionDetail(session domain.Session, messages []domain.ParsedMessage, subagents []domain.Process) domain.SessionDetail {
	return domain.SessionDetail{
		Session:   session,
		Messages:  messages,
		Chunks:    BuildChunks(messages, subagents),
		Processes: subagents,
		Metrics:   parsing.CalculateMetrics(messages),
	}
}
