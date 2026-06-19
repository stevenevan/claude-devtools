package searchservice

type SearchService struct{}

func (s *SearchService) Ready() (bool, error) { return true, nil }
